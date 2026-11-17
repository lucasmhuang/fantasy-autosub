"use client";

import { useEffect, useState } from "react";
import { freshText } from "./fresh-text";

const EVERY_HALF_MINUTE = 30_000;

// How old a reading is, kept current (FS-TIME-8): the server's time first, then the age on the
// browser's clock, every 30 seconds and whenever the page comes back into view. The time stays
// on hover.
export function FreshTime({ at, time }: { at: string; time: string }) {
  const [text, setText] = useState(time);
  useEffect(() => {
    const update = () => setText(freshText(at, new Date(), time));
    update();
    const timer = setInterval(update, EVERY_HALF_MINUTE);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [at, time]);
  return (
    <time dateTime={at} title={time}>
      {text}
    </time>
  );
}
