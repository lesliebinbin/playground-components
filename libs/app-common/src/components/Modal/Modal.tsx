/**
 * Label Studio Modal wrapper
 *
 * This file provides backward compatibility by wrapping @humansignal/ui Modal.
 */
import {
  modal as coreModal,
  confirm as coreConfirm,
  info as coreInfo,
  type ModalProps,
  type ModalUpdateProps,
} from "@humansignal/ui/lib/modal";

export type { ButtonProps as ButtonVariant } from "@humansignal/ui/lib/button/button";

const modalTypes = {
  modal: coreModal,
  confirm: coreConfirm,
  info: coreInfo,
} as const;

const createModal = (type: keyof typeof modalTypes) => {
  return <T,>(props: ModalProps<T>): ModalUpdateProps<T> => {
    return modalTypes[type]({
      simple: false,
      ...props,
    });
  };
};

// Re-export Modal component and hooks
/**
 * @deprecated Prefer `ModalWindow` from `@humansignal/ui` for new app chrome; keep using for gradual migration behind feature flags.
 */
export const modal = createModal("modal");
export const confirm = createModal("confirm");
export const info = createModal("info");
export { modal as standaloneModal };
export { Modal, useModalControls } from "@humansignal/ui/lib/modal";
