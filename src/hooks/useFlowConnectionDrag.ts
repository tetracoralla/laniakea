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
  FlowPlacementDirection,
  FlowSpace,
} from "../types/mindmap";

export interface FlowConnectionTargetSnapshot {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  endpoints: Record<FlowPlacementDirection, { x: number; y: number }>;
}

export interface FlowConnectionDragState {
  pointerId: number;
  fromId: string;
  fromPort: FlowPlacementDirection;
  start: { x: number; y: number };
  current: { x: number; y: number };
  targetId: string | null;
  targetPort: FlowPlacementDirection | null;
  targets: FlowConnectionTargetSnapshot[];
  canvasLeft: number;
  canvasTop: number;
}

interface FlowConnectionDragOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  onConnect: (
    fromId: string,
    toId: string,
    ports: {
      fromPort: FlowPlacementDirection;
      toPort: FlowPlacementDirection;
    },
  ) => void;
  onCreateFromPort: (
    fromId: string,
    fromPort: FlowPlacementDirection,
  ) => void;
  onSelect: (id: string | null) => void;
  space: FlowSpace;
}

export function flowTargetAtPoint(
  targets: readonly FlowConnectionTargetSnapshot[],
  clientX: number,
  clientY: number,
): FlowConnectionTargetSnapshot | null {
  const captureInset = 10;
  return targets
    .filter((target) =>
      clientX >= target.left - captureInset &&
      clientX <= target.right + captureInset &&
      clientY >= target.top - captureInset &&
      clientY <= target.bottom + captureInset,
    )
    .sort((left, right) => {
      const leftDistance = Math.hypot(
        clientX - (left.left + left.right) / 2,
        clientY - (left.top + left.bottom) / 2,
      );
      const rightDistance = Math.hypot(
        clientX - (right.left + right.right) / 2,
        clientY - (right.top + right.bottom) / 2,
      );
      return leftDistance - rightDistance || left.id.localeCompare(right.id);
    })[0] ?? null;
}

export function nearestFlowTargetPort(
  target: FlowConnectionTargetSnapshot,
  clientX: number,
  clientY: number,
): FlowPlacementDirection {
  const ports: Array<[
    FlowPlacementDirection,
    { x: number; y: number },
  ]> = [
    ["up", { x: (target.left + target.right) / 2, y: target.top }],
    ["right", { x: target.right, y: (target.top + target.bottom) / 2 }],
    ["down", { x: (target.left + target.right) / 2, y: target.bottom }],
    ["left", { x: target.left, y: (target.top + target.bottom) / 2 }],
  ];
  return ports.sort((left, right) => {
    const leftDistance = Math.hypot(clientX - left[1].x, clientY - left[1].y);
    const rightDistance = Math.hypot(clientX - right[1].x, clientY - right[1].y);
    return leftDistance - rightDistance;
  })[0][0];
}

export function useFlowConnectionDrag({
  containerRef,
  onConnect,
  onCreateFromPort,
  onSelect,
  space,
}: FlowConnectionDragOptions) {
  const [state, setState] = useState<FlowConnectionDragState | null>(null);
  const stateRef = useRef<FlowConnectionDragState | null>(null);
  const handledPortRef = useRef<{
    fromId: string;
    fromPort: FlowPlacementDirection;
  } | null>(null);
  const spaceIdRef = useRef(space.id);
  const frameRef = useRef(0);

  const replaceState = useCallback((
    next: FlowConnectionDragState | null,
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

  const releaseCapture = useCallback((pointerId: number) => {
    const canvas = containerRef.current;
    if (canvas?.hasPointerCapture?.(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
  }, [containerRef]);

  const focusCanvas = useCallback(() => {
    window.requestAnimationFrame(() =>
      containerRef.current?.focus({ preventScroll: true }),
    );
  }, [containerRef]);

  const cancel = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    releaseCapture(current.pointerId);
    replaceState(null);
    focusCanvas();
  }, [focusCanvas, releaseCapture, replaceState]);

  const begin = useCallback((
    fromId: string,
    fromPort: FlowPlacementDirection,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const canvas = containerRef.current;
    if (!canvas) return;
    const connectable = connectableFlowNodeIds(space, fromId);
    if (connectable.size === 0) return;
    const canvasBounds = canvas.getBoundingClientRect();
    const sourceBounds = event.currentTarget.getBoundingClientRect();
    const targets = Array.from(
      canvas.querySelectorAll<HTMLElement>("[data-flow-node-id]"),
    ).flatMap((element) => {
      const id = element.dataset.flowNodeId;
      if (!id || !connectable.has(id)) return [];
      const bounds = element.getBoundingClientRect();
      return [{
        id,
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
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
      }];
    });
    if (targets.length === 0) return;
    const start = {
      x: (sourceBounds.left + sourceBounds.right) / 2 - canvasBounds.left,
      y: (sourceBounds.top + sourceBounds.bottom) / 2 - canvasBounds.top,
    };
    onSelect(fromId);
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture?.(event.pointerId);
    replaceState({
      pointerId: event.pointerId,
      fromId,
      fromPort,
      start,
      current: start,
      targetId: null,
      targetPort: null,
      targets,
      canvasLeft: canvasBounds.left,
      canvasTop: canvasBounds.top,
    }, true);
  }, [containerRef, onSelect, replaceState, space]);

  const update = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ): FlowConnectionDragState | null => {
    const current = stateRef.current;
    if (!current || current.pointerId !== event.pointerId) return null;
    const target = flowTargetAtPoint(current.targets, event.clientX, event.clientY);
    const targetPort = target
      ? nearestFlowTargetPort(target, event.clientX, event.clientY)
      : null;
    const next = {
      ...current,
      current: target && targetPort ? target.endpoints[targetPort] : {
        x: event.clientX - current.canvasLeft,
        y: event.clientY - current.canvasTop,
      },
      targetId: target?.id ?? null,
      targetPort,
    };
    replaceState(
      next,
      current.targetId !== next.targetId || current.targetPort !== next.targetPort,
    );
    return next;
  }, [replaceState]);

  const pointerMove = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => update(event) !== null, [update]);

  const pointerUp = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const current = update(event);
    if (!current) return false;
    releaseCapture(current.pointerId);
    replaceState(null);
    const dragged = Math.hypot(
      current.current.x - current.start.x,
      current.current.y - current.start.y,
    ) >= 5;
    handledPortRef.current = {
      fromId: current.fromId,
      fromPort: current.fromPort,
    };
    if (current.targetId && current.targetPort) {
      onConnect(current.fromId, current.targetId, {
        fromPort: current.fromPort,
        toPort: current.targetPort,
      });
    } else if (!dragged) {
      onCreateFromPort(current.fromId, current.fromPort);
      return true;
    }
    focusCanvas();
    return true;
  }, [
    focusCanvas,
    onConnect,
    onCreateFromPort,
    releaseCapture,
    replaceState,
    update,
  ]);

  const pointerCancel = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (stateRef.current?.pointerId !== event.pointerId) return false;
    cancel();
    return true;
  }, [cancel]);

  const lostPointerCapture = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (stateRef.current?.pointerId !== event.pointerId) return;
    replaceState(null);
    focusCanvas();
  }, [focusCanvas, replaceState]);

  useDragInterruption({
    hasActiveDrag: () => stateRef.current !== null,
    onCancel: cancel,
  });

  useEffect(() => () => {
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    const current = stateRef.current;
    if (current) releaseCapture(current.pointerId);
  }, [releaseCapture]);

  useEffect(() => {
    if (spaceIdRef.current === space.id) return;
    spaceIdRef.current = space.id;
    if (stateRef.current) cancel();
  }, [cancel, space.id]);

  const connectableIds = useMemo(
    () => state
      ? connectableFlowNodeIds(space, state.fromId)
      : new Set<string>(),
    [space, state?.fromId],
  );
  const targetLabel = state?.targetId
    ? space.nodes[state.targetId]?.text || "未命名步骤"
    : "";

  return {
    active: () => stateRef.current !== null,
    begin,
    cancel,
    connectableIds,
    lostPointerCapture,
    pointerCancel,
    pointerMove,
    pointerUp,
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
        start: shiftPoint(current.start),
        current: target && current.targetPort
          ? target.endpoints[current.targetPort]
          : current.current,
        targets,
      });
    },
    consumeHandledPortClick: (
      fromId: string,
      fromPort: FlowPlacementDirection,
    ) => {
      const handled = handledPortRef.current;
      if (handled?.fromId !== fromId || handled.fromPort !== fromPort) {
        return false;
      }
      handledPortRef.current = null;
      return true;
    },
  };
}
