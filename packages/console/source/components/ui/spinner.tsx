import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"
import { useTranslation } from "@/i18n/provider"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const t = useTranslation()

  return (
    <Loader2Icon data-slot="spinner" role="status" aria-label={t('common.state.loading')} className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
