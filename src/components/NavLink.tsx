import { Link, type LinkProps } from "@tanstack/react-router";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface NavLinkCompatProps extends Omit<LinkProps, "className" | "activeProps" | "inactiveProps"> {
  className?: string;
  activeClassName?: string;
  pendingClassName?: string;
}

const NavLink = forwardRef<HTMLAnchorElement, NavLinkCompatProps>(
  ({ className, activeClassName, pendingClassName, to, ...props }, ref) => {
    return (
      <Link
        ref={ref}
        to={to}
        className={className}
        activeProps={{ className: activeClassName }}
        inactiveProps={pendingClassName ? { className: pendingClassName } : undefined}
        {...props}
      />
    );
  },
);

NavLink.displayName = "NavLink";

export { NavLink };
