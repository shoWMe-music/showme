import { Fragment } from "react";
import { classNames } from "@/lib/classNames";
import styles from "./Stepper.module.css";

export interface StepperProps {
  steps: string[];
  /** 0-based index of the active step. Steps up to and including it read as reached. */
  active: number;
  className?: string;
}

/** The multi-step progress indicator from the "New event" wizard: numbered dots
 * (gradient once reached) joined by a connector line that fills as you advance. */
export function Stepper({ steps, active, className }: StepperProps) {
  return (
    <div className={classNames(styles.stepper, className)}>
      {steps.map((label, index) => {
        const reached = index <= active;
        return (
          <Fragment key={label + index}>
            <div className={styles.step}>
              <span className={classNames(styles.dot, reached && styles.dotReached)}>{index + 1}</span>
              <span className={classNames(styles.label, reached && styles.labelReached)}>{label}</span>
            </div>
            {index < steps.length - 1 && (
              <span className={classNames(styles.line, index < active && styles.lineFilled)} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
