import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"
import { ChevronRight } from "lucide-react"
import { AppIcon } from "../AppIcon"
import { Button } from "./button"

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ children, ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" render={<Button variant="ghost" className="group/disclosure h-auto min-h-8 whitespace-normal text-start" />} {...props}>
      <AppIcon icon={ChevronRight} data-icon="inline-start" className="group-aria-expanded/disclosure:rotate-90" />
      {children}
    </CollapsiblePrimitive.Trigger>
  )
}

function CollapsibleContent({ ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
