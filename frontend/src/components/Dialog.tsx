import React, { useCallback } from "react";
import { FaCircleCheck, FaCircleXmark, FaTriangleExclamation, FaCircleInfo } from "react-icons/fa6";
import "../styles/dialog.css";

interface DialogProps {
  open: boolean;
  title: string;
  message: string;
  type?: "alert" | "confirm" | "warning" | "error" | "success";
  okLabel?: string;
  cancelLabel?: string;
  onOk?: () => void | Promise<void>;
  onCancel?: () => void;
  onClose: () => void;
  closeOnBackdropClick?: boolean;
  content?: React.ReactNode;
}

export const Dialog: React.FC<DialogProps> = ({
  open,
  title,
  message,
  type = "alert",
  okLabel = "OK",
  cancelLabel = "Cancel",
  onOk,
  onCancel,
  onClose,
  closeOnBackdropClick = true,
  content,
}) => {
  const [isLoading, setIsLoading] = React.useState(false);

  const handleOk = useCallback(async () => {
    setIsLoading(true);
    try {
      if (onOk) {
        await onOk();
      }
      onClose();
    } finally {
      setIsLoading(false);
    }
  }, [onOk, onClose]);

  const handleCancel = useCallback(() => {
    if (onCancel) {
      onCancel();
    }
    onClose();
  }, [onCancel, onClose]);

  const handleBackdropClick = useCallback(() => {
    if (closeOnBackdropClick) {
      handleCancel();
    }
  }, [closeOnBackdropClick, handleCancel]);

  if (!open) {
    return null;
  }

  const getIcon = () => {
    switch (type) {
      case "success":
        return <FaCircleCheck className="dialog-icon dialog-icon-success" />;
      case "error":
        return <FaCircleXmark className="dialog-icon dialog-icon-error" />;
      case "warning":
        return <FaTriangleExclamation className="dialog-icon dialog-icon-warning" />;
      default:
        return <FaCircleInfo className="dialog-icon dialog-icon-info" />;
    }
  };

  const isConfirm = type === "confirm" || type === "warning";

  return (
    <div className={`dialog-backdrop ${open ? "dialog-open" : ""}`} onClick={handleBackdropClick}>
      <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          {getIcon()}
          <h2 className="dialog-title">{title}</h2>
        </div>
        <div className="dialog-body">
          <p className="dialog-message">{message}</p>
          {content && <div className="dialog-extra">{content}</div>}
        </div>
        <div className="dialog-footer">
          {isConfirm && (
            <button
              className="dialog-button dialog-button-cancel"
              onClick={handleCancel}
              disabled={isLoading}
            >
              {cancelLabel}
            </button>
          )}
          <button
            className="dialog-button dialog-button-ok"
            onClick={handleOk}
            disabled={isLoading}
            autoFocus
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dialog;
