import type { ComponentProps } from "react"
import { cn } from "cn"

// The workspace owns the panel widths and collapsed state.
function Sidebar({ className, ...props }: ComponentProps<"aside">) {
  return (
    <aside
      data-slot="sidebar"
      className={cn(
        "flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground",
        className
      )}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn("flex min-h-0 flex-1 flex-col gap-0 overflow-auto", className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: ComponentProps<"footer">) {
  return (
    <footer
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

export { Sidebar, SidebarContent, SidebarFooter, SidebarHeader }
