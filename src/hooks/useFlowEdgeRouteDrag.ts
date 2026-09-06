import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  flowRouteAdjustmentHandle,
  type FlowConnectorRoute,
} from "../model/flowLayout";
import type { FlowEdgeRouteOverride } from "../types/mindmap";
import { useDragInterruption } from "./useDragInterruption";

interface ActiveRouteDrag {
  edgeId: string;
  element: SVGElement;
  original: FlowEdgeRouteOverride;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
}

interface FlowEdgeRouteDragOptions {
  onChange: (edgeId: string, route: FlowEdgeRouteOverride) => void;
  scopeKey: string;
  zoom: number;
}

export function useFlowEdgeRouteDrag({
  onChange,
  scopeKey,
  zoom,
}: FlowEdgeRouteDragOptions) {
  const activeRef = useRef<ActiveRouteDrag | null>(null);
  const previewRef = useRef<{
    edgeId: string;
    route: FlowEdgeRouteOverride;
  } | null>(null);
  const [preview, setPreview] = useState(previewRef.current);
  const scopeKeyRef = useRef(scopeKey);
  const frameRef = useRef(0);

  const release = useCallback((active: ActiveRouteDrag) => {
    if (active.element.hasPointerCapture?.(active.pointerId)) {
      active.element.releasePointerCapture(active.pointerId);
    }
  }, []);

  const clear = useCallback(() => {
    const active = activeRef.current;
    activeRef.current = null;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    previewRef.current = null;
    setPreview(null);
    if (active) release(active);
  }, [release]);

  const begin = useCallback((
    edgeId: string,
    route: FlowConnectorRoute,
    event: ReactPointerEvent<SVGElement>,
    preferred?: FlowEdgeRouteOverride,
  ) => {
    if (event.button !== 0) return;
    const handle = flowRouteAdjustmentHandle(route, preferred);
    if (!handle) return;
    event.preventDefault();
    event.stopPropagation();
    const original = { axis: handle.axis, coordinate: handle.coordinate };
    activeRef.current = {
      edgeId,
      element: event.currentTarget,
      original,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const update = useCallback((event: ReactPointerEvent<SVGElement>) => {
    const active = activeRef.current;
    if (!active || active.pointerId !== event.pointerId) return null;
    if (!active.moved && Math.hypot(event.clientX - active.startClientX, event.clientY - active.startClientY) < 4) return null;
    active.moved = true;
    event.preventDefault();
    event.stopPropagation();
    const delta = active.original.axis === "x"
      ? (event.clientX - active.startClientX) / zoom
      : (event.clientY - active.startClientY) / zoom;
    const coordinate = Math.round((active.original.coordinate + delta) / 6) * 6;
    const next = {
      edgeId: active.edgeId,
      route: { axis: active.original.axis, coordinate },
    };
    previewRef.current = next;
    if (!frameRef.current) frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      setPreview(previewRef.current);
    });
    return next;
  }, [zoom]);

  const pointerUp = useCallback((event: ReactPointerEvent<SVGElement>) => {
    const next = update(event);
    const active = activeRef.current;
    if (!active) return;
    clear();
    if (!next) return;
    if (next.route.coordinate !== active.original.coordinate) {
      onChange(next.edgeId, next.route);
    }
  }, [clear, onChange, update]);

  const pointerCancel = useCallback((event: ReactPointerEvent<SVGElement>) => {
    if (activeRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    clear();
  }, [clear]);

  useDragInterruption({
    hasActiveDrag: () => activeRef.current !== null,
    onCancel: clear,
  });

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, []);

  useEffect(() => {
    if (scopeKeyRef.current === scopeKey) return;
    scopeKeyRef.current = scopeKey;
    clear();
  }, [clear, scopeKey]);

  return {
    begin,
    cancel: clear,
    lostPointerCapture: (event: ReactPointerEvent<SVGElement>) => {
      if (activeRef.current?.pointerId === event.pointerId) clear();
    },
    pointerCancel,
    pointerMove: update,
    pointerUp,
    preview,
  };
}

export type FlowEdgeRouteDragController = ReturnType<typeof useFlowEdgeRouteDrag>;
