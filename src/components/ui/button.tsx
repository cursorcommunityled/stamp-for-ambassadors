import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm transition-[opacity,background-color,border-color] duration-150 ease-[var(--ease-out-quick)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-paper hover:opacity-80 active:opacity-70",
        outline: "hairline bg-transparent hover:opacity-60",
        ghost: "bg-transparent hover:opacity-60",
        link: "bg-transparent p-0 text-ink hover:opacity-60",
        danger: "hairline text-severity-high hover:opacity-70",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4",
        lg: "h-11 px-6",
        icon: "size-8",
        auto: "h-auto px-0",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
    compoundVariants: [
      { variant: "link", size: "md", class: "h-auto px-0" },
      { variant: "link", size: "sm", class: "h-auto px-0" },
    ],
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
