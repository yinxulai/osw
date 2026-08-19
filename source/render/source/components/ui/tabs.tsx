"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "@/lib/utils"

const TabsValueContext = React.createContext<string | undefined>(undefined)

const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ value, defaultValue, onValueChange, ...props }, ref) => {
  const [internalValue, setInternalValue] = React.useState(defaultValue)
  const currentValue = value ?? internalValue

  return (
    <TabsValueContext.Provider value={currentValue}>
      <TabsPrimitive.Root
        ref={ref}
        value={value}
        defaultValue={defaultValue}
        onValueChange={nextValue => {
          setInternalValue(nextValue)
          onValueChange?.(nextValue)
        }}
        {...props}
      />
    </TabsValueContext.Provider>
  )
})
Tabs.displayName = TabsPrimitive.Root.displayName

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, forwardedRef) => {
  const listRef = React.useRef<React.ElementRef<typeof TabsPrimitive.List>>(null)
  const indicatorRef = React.useRef<HTMLSpanElement>(null)
  const currentValue = React.useContext(TabsValueContext)

  React.useImperativeHandle(forwardedRef, () => listRef.current!)

  React.useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return

    const updateIndicator = () => {
      const activeTrigger = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
      const indicator = indicatorRef.current
      if (!activeTrigger || !indicator) return
      indicator.style.width = `${activeTrigger.offsetWidth}px`
      indicator.style.height = `${activeTrigger.offsetHeight}px`
      indicator.style.transform = `translate(${activeTrigger.offsetLeft}px, ${activeTrigger.offsetTop}px)`
      indicator.style.opacity = '1'
    }

    updateIndicator()
    const mutationObserver = new MutationObserver(updateIndicator)
    mutationObserver.observe(list, { attributes: true, subtree: true, attributeFilter: ['data-state'] })
    const resizeObserver = new ResizeObserver(updateIndicator)
    resizeObserver.observe(list)

    return () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [children, currentValue])

  return (
    <TabsPrimitive.List
      ref={listRef}
      className={cn(
        "relative inline-flex h-9 items-center justify-center rounded-sm border border-border bg-muted/70 p-0.5 text-sm text-muted-foreground",
        className
      )}
      {...props}
    >
      <span
        ref={indicatorRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 rounded-sm border border-border bg-background opacity-0 transition-[transform,width,height,opacity] duration-200 ease-out motion-reduce:transition-none"
      />
      {children}
    </TabsPrimitive.List>
  )
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative z-10 inline-flex items-center justify-center whitespace-nowrap rounded-sm border border-transparent px-3 py-1 text-sm font-medium ring-offset-background transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-primary",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
