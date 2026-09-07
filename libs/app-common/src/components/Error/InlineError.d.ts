import type { CSSProperties, ReactNode, FC } from "react";

export interface InlineErrorProps {
  minimal?: boolean;
  includeValidation?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export const InlineError: FC<InlineErrorProps>;
