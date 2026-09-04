import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { connectableFlowNodeIds } from "../model/spaces";
import { useDragInterruption } from "./useDragInterruption";
import type {
  FlowEdge,
  FlowPlacementDirection,
  FlowSpace,
} from "../types/mindmap";
import {
  flowTargetAtPoint,
  nearestFlowTargetPort,
  type FlowConnectionTargetSnapshot,
} from "./useFlowConnectionDrag";

export interface FlowEdgeReconnectState {
  canvasLeft: number;
  canvasTop: number;
  current: { x: number; y: number };
  edgeId: string;
  endpoint: "from" | "to";
  fixed: { x: number; y: number };
  fixedPort: FlowPlacementDirection;
  movingPort: FlowPlacementDirection;
  pointerId: number;
  targetId: string | null;
  targetPort: FlowPlacementDirection | null;
  targets: FlowConnectionTargetSnapshot[];
}

interface FlowEdgeReconnectOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  onReconnect: (
    edgeId: string,
    endpoint: "from" | "to",
    nodeId: string,
    port: FlowPlacementDirection,
  ) => void;
  onSelectEdge: (edgeId: string) => void;
  space: FlowSpace;
}

export function useFlowEdgeReconnect({
  containerRef,
  onReconnect,
  onSelectEdge,
  space,
}: FlowEdgeReconnectOptions) {
  const [state, setState] = useState<FlowEdgeReconnectState | null>(null);
  const stateRef = useRef<FlowEdgeReconnectState | null>(null);
  const spaceIdRef = useRef(space.id);
  const frameRef = useRef(0);

  const replaceState = useCallback((
    next: FlowEdgeReconnectState | null,
    immediate = false,
  ) => {
    stateRef.current = next;
    if (immediate || next === null) {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      setState(next);
      return;
    }
    if (!frameRef.current) {
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = 0;
        setState(stateRef.current);
      });
    }
  }, []);

  const release = useCallback((pointerId: number) => {
    const canvas = containerRef.current;
    if (canvas?.hasPointerCapture?.(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
  }, [containerRef]);

  const cancel = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    release(current.pointerId);
    replaceState(null);
    window.requestAnimationFrame(() =>
      containerRef.current?.focus({ preventScroll: true }),
    );
  }, [containerRef, release, replaceState]);

  const begin = useCallback((
    edge: FlowEdge,
    endpoint: "from" | "to",
    movingPort: FlowPlacementDirection,
    fixedPort: FlowPlacementDirection,
    event: ReactPointerEvent<SVGCircleElement>,
  ) => {
    const canvas = containerRef.current;
    if (!canvas || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const canvasBounds = canvas.getBoundingClientRect();
    const handleBounds = event.currentTarget.getBoundingClientRect();
    const oppositeHandle = canvas.querySelector<SVGCircleElement>(
      `[data-flow-edge-id="${edge.id}"][data-flow-edge-endpoint="${endpoint === "from" ? "to" : "from"}"]`,
    );
    const oppositeBounds = oppositeHandle?.getBoundingClientRect();
    if (!oppositeBounds) return;
    const withoutCurrent = {
      ...space,
      edges: space.edges.filter((candidate) => candidate.id !== edge.id),
    };
    const connectable = endpoint === "from"
      ? new Set(
          Object.keys(space.nodes).filter((candidateId) =>
            connectableFlowNodeIds(withoutCurrent, candidateId).has(edge.to),
          ),
        )
      : connectableFlowNodeIds(withoutCurrent, edge.from);
    const targets = Array.from(
      canvas.querySelectorAll<HTMLElement>("[data-flow-node-id]"),
    ).flatMap((element) => {
      const id = element.dataset.flowNodeId;
      if (!id || !connectable.has(id)) return [];
      const bounds = element.getBoundingClientRect();
      return [{
        bottom: bounds.bottom,
        endpoints: {
          up: {
            x: (bounds.left + bounds.right) / 2 - canvasBounds.left,
            y: bounds.top - canvasBounds.top,
          },
          right: {
            x: bounds.right - canvasBounds.left,
            y: (bounds.top + bounds.bottom) / 2 - canvasBounds.top,
          },
          down: {
            x: (bounds.left + bounds.right) / 2 - canvasBounds.left,
            y: bounds.bottom - canvasBounds.top,
          },
          left: {
            x: bounds.left - canvasBounds.left,
            y: (bounds.top + bounds.bottom) / 2 - canvasBounds.top,
          },
        },
        id,
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
      } satisfies FlowConnectionTargetSnapshot];
    });
    const current = {
      x: (handleBounds.left + handleBounds.right) / 2 - canvasBounds.left,
      y: (handleBounds.top + handleBounds.bottom) / 2 - canvasBounds.top,
    };
    const fixed = {
      x: (oppositeBounds.left + oppositeBounds.right) / 2 - canvasBounds.left,
      y: (oppositeBounds.top + oppositeBounds.bottom) / 2 - canvasBounds.top,
    };
    onSelectEdge(edge.id);
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture?.(event.pointerId);
    replaceState({
      canvasLeft: canvasBounds.left,
      canvasTop: canvasBounds.top,
      current,
      edgeId: edge.id,
      endpoint,
      fixed,
      fixedPort,
      movingPort,
      pointerId: event.pointerId,
      targetId: null,
      targetPort: null,
      targets,
    }, true);
  }, [containerRef, onSelectEdge, replaceState, space]);

  const update = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = stateRef.current;
    if (!current || current.pointerId !== event.pointerId) return null;
    const target = flowTargetAtPoint(current.targets, event.clientX, event.clientY);
    const targetPort = target
      ? nearestFlowTargetPort(target, event.clientX, event.clientY)
      : null;
    const next = {
      ...current,
      current: target && targetPort
        ? target.endpoints[targetPort]
        : {
            x: event.clientX - current.canvasLeft,
            y: event.clientY - current.canvasTop,
          },
      movingPort: targetPort ?? current.movingPort,
      targetId: target?.id ?? null,
      targetPort,
    };
    replaceState(
      next,
      current.targetId !== next.targetId || current.targetPort !== next.targetPort,
    );
    return next;
  }, [replaceState]);

  const pointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) =>
    update(event) !== null, [update]);

  const pointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = update(event);
    if (!current) return false;
    release(current.pointerId);
    replaceState(null);
    if (current.targetId && current.targetPort) {
      onReconnect(
        current.edgeId,
        current.endpoint,
        current.targetId,
        current.targetPort,
      );
    }
    window.requestAnimationFrame(() =>
      containerRef.current?.focus({ preventScroll: true }),
    );
    return true;
  }, [containerRef, onReconnect, release, replaceState, update]);

  const pointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (stateRef.current?.pointerId !== event.pointerId) return false;
    cancel();
    return true;
  }, [cancel]);

  const lostPointerCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (stateRef.current?.pointerId !== event.pointerId) return;
    replaceState(null);
  }, [replaceState]);

  useDragInterruption({
    hasActiveDrag: () => stateRef.current !== null,
    onCancel: cancel,
  });

  useEffect(() => {
    if (spaceIdRef.current === space.id) return;
    spaceIdRef.current = space.id;
    cancel();
  }, [cancel, space.id]);

  useEffect(() => () => {
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
  }, []);

  const connectableIds = useMemo(
    () => new Set(state?.targets.map((target) => target.id) ?? []),
    [state],
  );
  const targetLabel = state?.targetId
    ? space.nodes[state.targetId]?.text || "未命名步骤"
    : null;
  const preview = state
    ? state.endpoint === "from"
      ? {
          end: state.fixed,
          fromPort: state.targetPort ?? state.movingPort,
          start: state.current,
          toPort: state.fixedPort,
        }
      : {
          end: state.current,
          fromPort: state.fixedPort,
          start: state.fixed,
          toPort: state.targetPort ?? state.movingPort,
        }
    : null;

  return {
    active: () => stateRef.current !== null,
    begin,
    connectableIds,
    lostPointerCapture,
    pointerCancel,
    pointerMove,
    pointerUp,
    preview,
    state,
    targetLabel,
    shiftViewport: (x: number, y: number) => {
      const current = stateRef.current;
      if (!current) return;
      const shiftPoint = (point: { x: number; y: number }) => ({
        x: point.x + x,
        y: point.y + y,
      });
      const targets = current.targets.map((target) => ({
        ...target,
        bottom: target.bottom + y,
        left: target.left + x,
        right: target.right + x,
        top: target.top + y,
        endpoints: Object.fromEntries(
          Object.entries(target.endpoints).map(([port, point]) => [
            port,
            shiftPoint(point),
          ]),
        ) as FlowConnectionTargetSnapshot["endpoints"],
      }));
      const target = current.targetId
        ? targets.find(({ id }) => id === current.targetId)
        : null;
      replaceState({
        ...current,
        current: target && current.targetPort
          ? target.endpoints[current.targetPort]
          : current.current,
        fixed: shiftPoint(current.fixed),
        targets,
      });
    },
  };
}
