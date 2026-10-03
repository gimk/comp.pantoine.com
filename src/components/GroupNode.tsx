import React, { useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Boxes, Ungroup } from 'lucide-react';
import { hasTargetPort, paramPort, type ExposedParam, type GroupNodeData, type GroupPort } from '../state/graph';
import { groupHandle, moduleLabel, paramSpecsOf } from '../state/groups';
import { useGraph } from '../state/store';
import type { ParamValue } from '../engine/effects';
import { ParamRow } from './EffectNode';

/** A port's look, from what it carries: the same lugs the modules inside use. */
const portClass = (side: 'in' | 'out', port: GroupPort): string => {
  if (port.kind === 'param' || port.kind === 'field') {
    return 'port port-param' + (port.kind === 'field' ? ' port-field' : '');
  }
  return 'port ' + (side === 'in' ? 'port-in' : 'port-out') + (port.kind === 'mod' ? ' port-mod' : '');
};

/** A main picture port: what a module's title row carries. */
const isMainPicture = (port: GroupPort | undefined): boolean => port?.kind === 'picture' && port.handle === null;

/**
 * A port's name in two parts, the module it belongs to dimmed before what it
 * is on that module -- "Grain Amount" -- so a column of them scans by port.
 */
const PortLabel: React.FC<{ port: GroupPort }> = ({ port }) => {
  const [module, ...rest] = port.label.split(' · ');
  return (
    <span className="group-port-label" title={port.label}>
      {rest.length > 0 ? (
        <>
          <span className="group-port-module">{module}</span> {rest.join(' · ')}
        </>
      ) : (
        module
      )}
    </span>
  );
};

/** The group's name, renamed by double-clicking it. */
const GroupName: React.FC<{ id: string; name: string }> = ({ id, name }) => {
  const renameGroup = useGraph((state) => state.renameGroup);
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <span className="group-name" title="Double-click to rename" onDoubleClick={() => setDraft(name)}>
        {name}
      </span>
    );
  }
  const commit = () => {
    renameGroup(id, draft.trim() || name);
    setDraft(null);
  };
  return (
    <input
      className="group-name-input nodrag"
      value={draft}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') {
          // Escape on the canvas clears the selection; here it only cancels.
          event.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
};

/** The index of the group's input port for a member param, or -1. */
const exposedPortIndex = (inputs: GroupPort[], param: ExposedParam): number =>
  inputs.findIndex((port) => port.node === param.node && port.handle === paramPort(param.key));

/**
 * One member param, on the group's card: the module's own row, socket and
 * all. The value is the member's, set through the member -- the card is
 * only a second place to reach it -- and its socket is the group's port for
 * that param, so a wire dropped on it lands on the member. Driven from
 * inside the group, it has no socket and is locked, as on the module.
 */
const ExposedControl: React.FC<{ param: ExposedParam; inputs: GroupPort[] }> = ({ param, inputs }) => {
  const setParam = useGraph((state) => state.setParam);
  const node = useGraph((state) => state.nodes.find((candidate) => candidate.id === param.node));
  const spec = node && paramSpecsOf(node).find((candidate) => candidate.key === param.key);
  if (!node || !spec || !('params' in node.data)) return null;
  const params = node.data.params as Record<string, ParamValue>;
  const index = exposedPortIndex(inputs, param);
  return (
    <ParamRow
      nodeId={node.id}
      spec={param.label ? { ...spec, label: param.label } : spec}
      value={params[param.key]}
      port={index >= 0 || hasTargetPort(node, paramPort(param.key))}
      field={inputs[index]?.kind === 'field'}
      handleId={index >= 0 ? groupHandle('in', index) : null}
      inactive={spec.activeWhen ? !spec.activeWhen(params) : false}
      onChange={(value) => setParam(node.id, param.key, value)}
    />
  );
};

/**
 * The params the group was set to show, under the name of the module each
 * belongs to -- one heading per run of params from the same module.
 */
const ExposedControls: React.FC<{ exposed: ExposedParam[]; inputs: GroupPort[] }> = ({ exposed, inputs }) => {
  const labels = useGraph((state) => {
    const byId = new Map(state.nodes.map((node) => [node.id, node]));
    return JSON.stringify(Object.fromEntries(exposed.map((param) => {
      const node = byId.get(param.node);
      return [param.node, node ? moduleLabel(node) : ''];
    })));
  });
  const names: Record<string, string> = JSON.parse(labels);
  const runs: { node: string; params: ExposedParam[] }[] = [];
  for (const param of exposed) {
    const last = runs[runs.length - 1];
    if (last?.node === param.node) last.params.push(param);
    else runs.push({ node: param.node, params: [param] });
  }
  return (
    <div className="group-params">
      {runs.map((run, i) => (
        <div className="group-params-module" key={`${run.node}-${i}`}>
          <span className="group-params-heading">{names[run.node]}</span>
          {run.params.map((param) => (
            <ExposedControl key={param.key} param={param} inputs={inputs} />
          ))}
        </div>
      ))}
    </div>
  );
};

/**
 * Several modules shown as one closed box.
 *
 * Laid out like a module: the picture going in and coming out on the title
 * row, where every other card has them, and any other ports below in pairs,
 * inputs down the left and outputs down the right. What is inside is named
 * but only the params the group was set to show (see the preset dialog)
 * can be changed from here: Ungroup puts the modules back on the canvas,
 * wired exactly as they were, for the rest.
 */
export const GroupNode: React.FC<NodeProps<Node<GroupNodeData, 'moduleGroup'>>> = ({ id, data }) => {
  const ungroup = useGraph((state) => state.ungroup);
  // What is inside, by name. A string, so the card only re-renders when that changes.
  const contents = useGraph((state) =>
    data.members
      .flatMap((member) => {
        const node = state.nodes.find((candidate) => candidate.id === member);
        return node ? [moduleLabel(node)] : [];
      })
      .join('\n'),
  );

  // The first main picture on each side goes on the title row; the ports
  // keep their index, which is what their handle id is made from.
  // An exposed param's port sits on its control's row, not down here; an
  // exposed input has no control, and stays here with the other ports.
  const controls = (data.exposed ?? []).filter((param) => !param.input);
  const exposedPorts = new Set(controls.map((param) => exposedPortIndex(data.inputs, param)));
  const inputs = data.inputs.map((port, index) => ({ port, index })).filter(({ index }) => !exposedPorts.has(index));
  const outputs = data.outputs.map((port, index) => ({ port, index }));
  const titleIn = isMainPicture(inputs[0]?.port) ? inputs.shift() : undefined;
  const titleOut = isMainPicture(outputs[0]?.port) ? outputs.shift() : undefined;
  const rows = Array.from({ length: Math.max(inputs.length, outputs.length) }, (_, i) => [inputs[i], outputs[i]] as const);

  return (
    <div className="node node-group">
      {/* First in the DOM, like a module's main input. */}
      {titleIn && (
        <Handle
          type="target"
          id={groupHandle('in', titleIn.index)}
          position={Position.Left}
          className={portClass('in', titleIn.port) + ' port-title'}
          title={titleIn.port.label}
        />
      )}

      <div className="node-title">
        <Boxes size={13} />
        <GroupName id={id} name={data.name} />
        <button
          type="button"
          className="group-ungroup nodrag"
          onClick={(event) => {
            event.stopPropagation();
            ungroup(id);
          }}
          title="Ungroup, to edit the modules inside (Ctrl+Shift+G)"
          aria-label="Ungroup"
        >
          <Ungroup size={12} />
          <span>Ungroup</span>
        </button>
      </div>

      <div className="node-body group-body">
        <ul className="group-members" aria-label="Modules in this group">
          {contents.split('\n').filter(Boolean).map((label, i) => (
            <li className="group-member" key={i}>
              {label}
            </li>
          ))}
        </ul>

        {controls.length > 0 && <ExposedControls exposed={controls} inputs={data.inputs} />}

        {rows.length > 0 && (
          <div className="group-ports">
            {rows.map(([input, output], i) => (
              <div className="group-port-row" key={i}>
                <div className="group-port group-port-in">
                  {input && (
                    <>
                      <Handle
                        type="target"
                        id={groupHandle('in', input.index)}
                        position={Position.Left}
                        className={portClass('in', input.port)}
                        title={input.port.label}
                      />
                      <PortLabel port={input.port} />
                    </>
                  )}
                </div>
                <div className="group-port group-port-out">
                  {output && (
                    <>
                      <PortLabel port={output.port} />
                      <Handle
                        type="source"
                        id={groupHandle('out', output.index)}
                        position={Position.Right}
                        className={portClass('out', output.port)}
                        title={output.port.label}
                      />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {titleOut && (
        <Handle
          type="source"
          id={groupHandle('out', titleOut.index)}
          position={Position.Right}
          className={portClass('out', titleOut.port) + ' port-title'}
          title={titleOut.port.label}
        />
      )}
    </div>
  );
};
