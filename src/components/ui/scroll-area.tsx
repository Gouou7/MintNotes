import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import type { ComponentPropsWithRef, ReactNode } from "react";

type ScrollAreaProps = ComponentPropsWithRef<typeof ScrollAreaPrimitive.Root> & {
  header: ReactNode;
  footer?: ReactNode;
  viewport: ComponentPropsWithRef<typeof ScrollAreaPrimitive.Viewport>;
  contentClassName: string;
};

export function ScrollArea({ header, footer, viewport, contentClassName, children, ...props }: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" {...props}>
      {header}
      <ScrollAreaPrimitive.Viewport data-slot="scroll-area-viewport" {...viewport}>
        <ScrollAreaPrimitive.Content className={contentClassName} style={{ minWidth: 0 }}>
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar orientation="vertical" />
      <ScrollBar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner style={{ bottom: "var(--scrollbar-inset-bottom, 0px)" }} />
      {footer}
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const style = orientation === "vertical"
    ? {
        top: "var(--scrollbar-inset-top, 0px)",
        bottom: "calc(var(--scrollbar-inset-bottom, 0px) + var(--scroll-area-corner-height))",
      }
    : { bottom: "var(--scrollbar-inset-bottom, 0px)" };
  return (
    <ScrollAreaPrimitive.Scrollbar data-slot="scroll-area-scrollbar" orientation={orientation} style={style}>
      <ScrollAreaPrimitive.Thumb data-slot="scroll-area-thumb" className="rounded-full bg-muted-foreground/70" />
    </ScrollAreaPrimitive.Scrollbar>
  );
}
