import { useCallback, useRef, useState } from "react";
import { Button } from "@humansignal/ui";
import { LeaveBlocker, type LeaveBlockerCallbacks } from "./LeaveBlocker/LeaveBlocker";
import { modal } from "./Modal/Modal";
import { Space } from "./Space/Space";

type SaveAndLeaveButtonProps = {
  onSave: () => Promise<void>;
  text?: string;
};
const SaveAndLeaveButton = ({ onSave, text = "Save and Leave" }: SaveAndLeaveButtonProps) => {
  const [saving, setSaving] = useState(false);
  const saveHandler = useCallback(async () => {
    setSaving(true);
    await onSave();
    setSaving(false);
  }, [onSave]);
  return (
    <Button size="small" onClick={saveHandler} waiting={saving} aria-label="Save changes">
      {text}
    </Button>
  );
};

type UnsavedChangesModalProps = {
  onSave: () => void;
  onCancel?: () => void;
  onDiscard?: () => void;
  cancelText?: string;
  discardText?: string;
  okText?: string;
  title?: string;
  body?: string;
};

export const unsavedChangesModal = ({
  onSave,
  onCancel,
  onDiscard,
  cancelText,
  discardText,
  okText,
  title = "You have unsaved changes.",
  body = "Would you like to save them before leaving?",
  ...props
}: UnsavedChangesModalProps) => {
  let modalInstance: any;
  const saveAndLeave = async () => {
    await onSave?.();
    modalInstance?.close();
  };
  modalInstance = modal({
    ...props,
    title,
    body: () => <>{body}</>,
    allowClose: true,
    footer: (
      <Space align="end">
        <Button
          look="outlined"
          size="small"
          onClick={() => {
            onCancel?.();
            modalInstance?.close();
          }}
          autoFocus
        >
          {cancelText ?? "Cancel"}
        </Button>

        {onDiscard && (
          <Button
            variant="negative"
            look="outlined"
            onClick={() => {
              onDiscard?.();
              modalInstance?.close();
            }}
            size="small"
          >
            {discardText ?? "Discard and leave"}
          </Button>
        )}

        <SaveAndLeaveButton onSave={saveAndLeave} text={okText} />
      </Space>
    ),
    style: { width: 512 },
    unique: "UNSAVED_CHANGES_MODAL",
  });
};

type UnsavedChangesProps = {
  hasChanges: boolean;
  onSave: () => any;
};

export const UnsavedChanges = ({ hasChanges, onSave }: UnsavedChangesProps) => {
  const saveHandlerRef = useRef(onSave);
  saveHandlerRef.current = onSave;
  const blockHandler = useCallback(async ({ continueCallback, cancelCallback }: LeaveBlockerCallbacks) => {
    const wrappedOnSave = async () => {
      const result = await saveHandlerRef.current?.();
      if (result === true) {
        continueCallback && setTimeout(continueCallback, 0);
      } else {
        cancelCallback?.();
      }
    };

    unsavedChangesModal({
      onSave: wrappedOnSave,
      onCancel: cancelCallback,
      onDiscard: continueCallback,
    });
  }, []);

  return <LeaveBlocker active={hasChanges} onBlock={blockHandler} />;
};
