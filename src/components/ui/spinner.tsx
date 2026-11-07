import { cn } from "cn"
import { Loader2Icon } from "lucide-react"
import { AppIcon } from "../AppIcon"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <AppIcon icon={Loader2Icon} data-slot="spinner" role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
