"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

const DEFAULT_BOTTOM_THRESHOLD_PX = 24;

export function isScrollNearBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  thresholdPx = DEFAULT_BOTTOM_THRESHOLD_PX,
) {
  return scrollHeight - clientHeight - scrollTop <= thresholdPx;
}

function scrollElementToBottom(element: HTMLElement) {
  element.scrollTop = element.scrollHeight;
}

export function useAutoScrollBottom<T extends HTMLElement>(
  changeKey: string,
  thresholdPx = DEFAULT_BOTTOM_THRESHOLD_PX,
) {
  const containerRef = useRef<T | null>(null);
  const stickToBottomRef = useRef(true);
  const initializedRef = useRef(false);
  const previousChangeKeyRef = useRef(changeKey);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const handleScroll = () => {
      stickToBottomRef.current = isScrollNearBottom(
        element.scrollTop,
        element.clientHeight,
        element.scrollHeight,
        thresholdPx,
      );
    };

    handleScroll();
    element.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", handleScroll);
    };
  }, [thresholdPx]);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    if (!initializedRef.current) {
      scrollElementToBottom(element);
      stickToBottomRef.current = true;
      initializedRef.current = true;
      previousChangeKeyRef.current = changeKey;
      return;
    }

    if (previousChangeKeyRef.current !== changeKey && stickToBottomRef.current) {
      scrollElementToBottom(element);
    }

    previousChangeKeyRef.current = changeKey;
  }, [changeKey]);

  return containerRef;
}
