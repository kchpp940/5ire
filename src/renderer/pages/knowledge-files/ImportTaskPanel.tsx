import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Dropdown,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Option,
  ProgressBar,
  Spinner,
  Tooltip,
} from "@fluentui/react-components";
import {
  ArrowRepeatAllFilled,
  ArrowRepeatAllRegular,
  bundleIcon,
  DeleteFilled,
  DeleteRegular,
  DismissCircleFilled,
  DismissCircleRegular,
  FolderArrowRightFilled,
  FolderArrowRightRegular,
  MoreHorizontalFilled,
  MoreHorizontalRegular,
  PlayCircleFilled,
  PlayCircleRegular,
  CheckmarkCircleFilled,
  CheckmarkCircleRegular,
  ClockFilled,
  ClockRegular,
  WarningFilled,
  WarningRegular,
} from "@fluentui/react-icons";
import { asError } from "catch-unknown";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import useToast from "@/hooks/useToast";
import { captureException } from "@/renderer/logging";
import { useDocumentEmbedder } from "@/renderer/next/hooks/remote/use-document-embedder";
import { useLiveCollections } from "@/renderer/next/hooks/remote/use-live-collections";
import { useLiveDocuments } from "@/renderer/next/hooks/remote/use-live-documents";
import ConfirmDialog from "renderer/components/ConfirmDialog";

type LiveDocument = {
  id: string;
  name: string;
  url: string;
  status: "pending" | "processing" | "completed" | "failed";
  error: string | null;
  createTime: Date;
  updateTime: Date;
  size: number;
  chunks: number;
};

const RetryIcon = bundleIcon(ArrowRepeatAllFilled, ArrowRepeatAllRegular);
const DeleteIcon = bundleIcon(DeleteFilled, DeleteRegular);
const MoveIcon = bundleIcon(FolderArrowRightFilled, FolderArrowRightRegular);
const MoreIcon = bundleIcon(MoreHorizontalFilled, MoreHorizontalRegular);
const PendingIcon = bundleIcon(ClockFilled, ClockRegular);
const SuccessIcon = bundleIcon(CheckmarkCircleFilled, CheckmarkCircleRegular);
const ErrorIcon = bundleIcon(DismissCircleFilled, DismissCircleRegular);
const ProcessingIcon = bundleIcon(PlayCircleFilled, PlayCircleRegular);
const WarningIcon = bundleIcon(WarningFilled, WarningRegular);

type ImportTaskPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type TaskStatus = "pending" | "extracting" | "embedding" | "saving" | "completed" | "failed";

const getTaskStatus = (doc: LiveDocument, processing: Record<string, { status: string; progress: number }>): TaskStatus => {
  if (doc.status === "completed") return "completed";
  if (doc.status === "failed") return "failed";
  if (doc.status === "processing") {
    const p = processing[doc.id];
    if (p) {
      return p.status as TaskStatus;
    }
    return "extracting";
  }
  return "pending";
};

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
};

export default function ImportTaskPanel(props: ImportTaskPanelProps) {
  const { open, onOpenChange } = props;
  const { id } = useParams();
  const { t } = useTranslation();
  const { notifySuccess, notifyError } = useToast();

  const documents = useLiveDocuments(id || "");
  const embedder = useDocumentEmbedder();
  const collections = useLiveCollections();

  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveCollectionId, setMoveCollectionId] = useState<string>("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showMoveDialog, setShowMoveDialog] = useState(false);

  const activeDocuments = useMemo(() => {
    return documents.rows.filter(
      (doc) => doc.status !== "completed",
    );
  }, [documents.rows]);

  const stats = useMemo(() => {
    const total = documents.rows.length;
    const pending = documents.rows.filter((d) => d.status === "pending").length;
    const processing = documents.rows.filter((d) => d.status === "processing").length;
    const completed = documents.rows.filter((d) => d.status === "completed").length;
    const failed = documents.rows.filter((d) => d.status === "failed").length;
    return { total, pending, processing, completed, failed };
  }, [documents.rows]);

  const handleRetry = async (docId: string) => {
    setRetryingId(docId);
    try {
      await window.bridge.documentManager.retryDocument({ id: docId });
      notifySuccess(t("Knowledge.Notification.DocumentRetried", { defaultValue: "Document re-queued successfully" }));
    } catch (err) {
      const error = asError(err);
      captureException(error);
      notifyError(error.message);
    } finally {
      setRetryingId(null);
    }
  };

  const handleDelete = async (docId: string) => {
    try {
      await window.bridge.documentManager.deleteDocument({ id: docId });
      notifySuccess(t("Knowledge.Notification.DocumentDeleted"));
    } catch (err) {
      const error = asError(err);
      captureException(error);
      notifyError(error.message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleMove = async (docId: string, targetCollectionId: string) => {
    setMovingId(docId);
    try {
      await window.bridge.documentManager.moveDocumentToCollection({
        documentId: docId,
        collectionId: targetCollectionId,
      });
      notifySuccess(
        t("Knowledge.Notification.DocumentMoved", { defaultValue: "Document moved successfully" }),
      );
      setShowMoveDialog(false);
    } catch (err) {
      const error = asError(err);
      captureException(error);
      notifyError(error.message);
    } finally {
      setMovingId(null);
      setMoveCollectionId("");
    }
  };

  const openMoveDialog = (docId: string) => {
    setMovingId(docId);
    setMoveCollectionId("");
    setShowMoveDialog(true);
  };

  const handleRetryAllFailed = async () => {
    const failedDocs = documents.rows.filter((d) => d.status === "failed");
    for (const doc of failedDocs) {
      try {
        await window.bridge.documentManager.retryDocument({ id: doc.id });
      } catch (err) {
        captureException(asError(err));
      }
    }
    notifySuccess(
      t("Knowledge.Notification.AllFailedRetried", {
        defaultValue: "{{count}} documents re-queued",
        count: failedDocs.length,
      }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface className="min-w-[640px] max-w-[800px]">
        <DialogBody>
          <DialogTitle>
            {t("Knowledge.ImportTaskPanel.Title", { defaultValue: "Import Tasks" })}
          </DialogTitle>
          <DialogContent>
            <div className="flex flex-col gap-4">
              <div className="flex gap-6 p-3 bg-gray-50 rounded-lg">
                <StatItem
                  label={t("Document.Status.Pending")}
                  value={stats.pending}
                  icon={<PendingIcon fontSize={16} className="text-gray-500" />}
                />
                <StatItem
                  label={t("Document.Status.Processing")}
                  value={stats.processing}
                  icon={<Spinner size="extra-tiny" />}
                />
                <StatItem
                  label={t("Document.Status.Completed")}
                  value={stats.completed}
                  icon={<SuccessIcon fontSize={16} className="text-green-500" />}
                />
                <StatItem
                  label={t("Document.Status.Failed")}
                  value={stats.failed}
                  icon={<ErrorIcon fontSize={16} className="text-red-500" />}
                />
              </div>

              {stats.failed > 0 && (
                <div className="flex justify-end">
                  <Button
                    appearance="primary"
                    size="small"
                    icon={<RetryIcon />}
                    onClick={handleRetryAllFailed}
                  >
                    {t("Knowledge.ImportTaskPanel.RetryAllFailed", {
                      defaultValue: "Retry All Failed",
                    })}
                  </Button>
                </div>
              )}

              <div className="border rounded-lg max-h-[400px] overflow-y-auto">
                {activeDocuments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                    <SuccessIcon fontSize={32} className="text-green-400 mb-2" />
                    <p className="text-sm">
                      {t("Knowledge.ImportTaskPanel.AllCompleted", {
                        defaultValue: "All documents have been processed",
                      })}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {activeDocuments.map((doc) => (
                      <TaskRow
                        key={doc.id}
                        document={doc}
                        processing={embedder.processingDocuments[doc.id]}
                        onRetry={() => handleRetry(doc.id)}
                        onDelete={() => setDeletingId(doc.id)}
                        onMove={() => openMoveDialog(doc.id)}
                        isRetrying={retryingId === doc.id}
                        isMoving={movingId === doc.id}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary">{t("Common.Close")}</Button>
            </DialogTrigger>
          </DialogActions>
        </DialogBody>

        <ConfirmDialog
          open={!!deletingId}
          setOpen={() => setDeletingId(null)}
          message={t("Knowledge.Confirmation.DeleteDocument")}
          onConfirm={() => deletingId && handleDelete(deletingId)}
        />

        {showMoveDialog && movingId && (
          <MoveCollectionDialog
            open={showMoveDialog}
            onOpenChange={setShowMoveDialog}
            collections={collections.rows.filter((c) => c.id !== id)}
            selectedCollectionId={moveCollectionId}
            onSelectedChange={setMoveCollectionId}
            onConfirm={() => moveCollectionId && handleMove(movingId, moveCollectionId)}
            isMoving={movingId === movingId}
          />
        )}
      </DialogSurface>
    </Dialog>
  );
}

function StatItem({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <div>
        <p className="text-lg font-semibold leading-none">{value}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function TaskRow({
  document,
  processing,
  onRetry,
  onDelete,
  onMove,
  isRetrying,
  isMoving,
}: {
  document: LiveDocument;
  processing?: { status: string; progress: number };
  onRetry: () => void;
  onDelete: () => void;
  onMove: () => void;
  isRetrying: boolean;
  isMoving: boolean;
}) {
  const { t } = useTranslation();

  const status = getTaskStatus(document, processing ? { [document.id]: processing } : {});
  const progress = processing?.progress || 0;

  const statusInfo = {
    pending: {
      icon: <PendingIcon fontSize={16} className="text-gray-500" />,
      label: t("Document.Status.Pending"),
      color: "text-gray-600",
    },
    extracting: {
      icon: <Spinner size="extra-tiny" />,
      label: t("Document.ProcessStatus.Extracting"),
      color: "text-blue-600",
    },
    embedding: {
      icon: <Spinner size="extra-tiny" />,
      label: t("Document.ProcessStatus.Embedding"),
      color: "text-blue-600",
    },
    saving: {
      icon: <Spinner size="extra-tiny" />,
      label: t("Document.ProcessStatus.Saving"),
      color: "text-blue-600",
    },
    completed: {
      icon: <SuccessIcon fontSize={16} className="text-green-500" />,
      label: t("Document.Status.Completed"),
      color: "text-green-600",
    },
    failed: {
      icon: <ErrorIcon fontSize={16} className="text-red-500" />,
      label: t("Document.Status.Failed"),
      color: "text-red-600",
    },
  }[status];

  const isProcessing = status === "extracting" || status === "embedding" || status === "saving";

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
      <div className="flex-shrink-0">{statusInfo.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{document.name}</span>
          <span className="text-xs text-gray-400 flex-shrink-0">
            {formatFileSize(document.size)}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-xs ${statusInfo.color}`}>{statusInfo.label}</span>
          {isProcessing && (
            <span className="text-xs text-gray-500">{(progress * 100).toFixed(1)}%</span>
          )}
          {document.status === "failed" && document.error && (
            <Tooltip relationship="description" content={document.error}>
              <WarningIcon fontSize={12} className="text-orange-500" />
            </Tooltip>
          )}
        </div>
        {isProcessing && (
          <div className="w-full max-w-xs mt-1.5">
            <ProgressBar value={progress} />
          </div>
        )}
      </div>
      <div className="flex-shrink-0">
        {document.status === "failed" ? (
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button icon={<MoreIcon />} appearance="subtle" size="small" />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem
                  icon={<RetryIcon />}
                  onClick={onRetry}
                  disabled={isRetrying || isMoving}
                >
                  {t("Knowledge.ImportTaskPanel.Retry", { defaultValue: "Retry" })}
                </MenuItem>
                <MenuItem
                  icon={<MoveIcon />}
                  onClick={onMove}
                  disabled={isRetrying || isMoving}
                >
                  {t("Knowledge.ImportTaskPanel.Move", { defaultValue: "Move to Collection" })}
                </MenuItem>
                <MenuItem icon={<DeleteIcon />} onClick={onDelete}>
                  {t("Common.Delete")}
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        ) : null}
      </div>
    </div>
  );
}

function MoveCollectionDialog({
  open,
  onOpenChange,
  collections,
  selectedCollectionId,
  onSelectedChange,
  onConfirm,
  isMoving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collections: { id: string; name: string }[];
  selectedCollectionId: string;
  onSelectedChange: (id: string) => void;
  onConfirm: () => void;
  isMoving: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface className="min-w-[400px]">
        <DialogBody>
          <DialogTitle>
            {t("Knowledge.ImportTaskPanel.MoveTitle", {
              defaultValue: "Move to Collection",
            })}
          </DialogTitle>
          <DialogContent>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-gray-600">
                {t("Knowledge.ImportTaskPanel.MoveDescription", {
                  defaultValue: "Select a target collection to move the document to.",
                })}
              </p>
              <Dropdown
                value={collections.find((c) => c.id === selectedCollectionId)?.name || ""}
                selectedOptions={selectedCollectionId ? [selectedCollectionId] : []}
                onOptionSelect={(_, data) => {
                  if (data.optionValue) {
                    onSelectedChange(data.optionValue);
                  }
                }}
                placeholder={t("Knowledge.ImportTaskPanel.SelectCollection", {
                  defaultValue: "Select a collection",
                })}
              >
                {collections.map((collection) => (
                  <Option key={collection.id} value={collection.id}>
                    {collection.name}
                  </Option>
                ))}
              </Dropdown>
            </div>
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary">{t("Common.Cancel")}</Button>
            </DialogTrigger>
            <Button
              appearance="primary"
              onClick={onConfirm}
              disabled={!selectedCollectionId || isMoving}
            >
              {t("Common.Move", { defaultValue: "Move" })}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
