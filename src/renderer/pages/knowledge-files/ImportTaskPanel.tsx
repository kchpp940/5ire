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
  ChevronDownFilled,
  ChevronRightFilled,
} from "@fluentui/react-icons";
import { asError } from "catch-unknown";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import useToast from "@/hooks/useToast";
import { captureException } from "@/renderer/logging";
import { useLiveCollections } from "@/renderer/next/hooks/remote/use-live-collections";
import { useLiveImportJobs, type ImportJob } from "@/renderer/next/hooks/remote/use-live-import-jobs";
import ConfirmDialog from "renderer/components/ConfirmDialog";

const RetryIcon = bundleIcon(ArrowRepeatAllFilled, ArrowRepeatAllRegular);
const DeleteIcon = bundleIcon(DeleteFilled, DeleteRegular);
const MoveIcon = bundleIcon(FolderArrowRightFilled, FolderArrowRightRegular);
const MoreIcon = bundleIcon(MoreHorizontalFilled, MoreHorizontalRegular);
const PendingIcon = bundleIcon(ClockFilled, ClockRegular);
const SuccessIcon = bundleIcon(CheckmarkCircleFilled, CheckmarkCircleRegular);
const ErrorIcon = bundleIcon(DismissCircleFilled, DismissCircleRegular);
const ProcessingIcon = bundleIcon(PlayCircleFilled, PlayCircleRegular);
const WarningIcon = bundleIcon(WarningFilled, WarningRegular);
const ChevronDown = bundleIcon(ChevronDownFilled, ChevronDownFilled);
const ChevronRight = bundleIcon(ChevronRightFilled, ChevronRightFilled);

type ImportTaskPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeJobId?: string | null;
};

type TaskStatus = "pending" | "extracting" | "embedding" | "saving" | "completed" | "failed";

const getTaskStatus = (doc: ImportJob["documents"][string]): TaskStatus => {
  if (doc.status === "completed") return "completed";
  if (doc.status === "failed") return "failed";
  if (doc.status === "processing" && doc.stage) return doc.stage;
  return "pending";
};

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
};

const formatTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return "";
  }
};

export default function ImportTaskPanel(props: ImportTaskPanelProps) {
  const { open, onOpenChange, activeJobId } = props;
  const { id } = useParams();
  const { t } = useTranslation();
  const { notifySuccess, notifyError } = useToast();

  const jobs = useLiveImportJobs();
  const collections = useLiveCollections();

  const [retryingDocId, setRetryingDocId] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [movingDocId, setMovingDocId] = useState<string | null>(null);
  const [moveCollectionId, setMoveCollectionId] = useState<string>("");
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());

  const toggleJobExpanded = (jobId: string) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  const totalStats = useMemo(() => {
    let pending = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;
    for (const job of jobs) {
      pending += job.pendingCount;
      processing += job.processingCount;
      completed += job.completedCount;
      failed += job.failedCount;
    }
    return { pending, processing, completed, failed, total: jobs.length };
  }, [jobs]);

  const handleRetryDoc = async (docId: string) => {
    setRetryingDocId(docId);
    try {
      await window.bridge.documentManager.retryDocument({ id: docId });
      notifySuccess(t("Knowledge.Notification.DocumentRetried", { defaultValue: "Document re-queued successfully" }));
    } catch (err) {
      const error = asError(err);
      captureException(error);
      notifyError(error.message);
    } finally {
      setRetryingDocId(null);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    setRetryingJobId(jobId);
    try {
      await window.bridge.documentManager.retryImportJob(jobId);
      notifySuccess(
        t("Knowledge.Notification.ImportJobRetried", {
          defaultValue: "Failed documents re-queued",
        }),
      );
    } catch (err) {
      const error = asError(err);
      captureException(error);
      notifyError(error.message);
    } finally {
      setRetryingJobId(null);
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    try {
      await window.bridge.documentManager.deleteDocument({ id: docId });
      notifySuccess(t("Knowledge.Notification.DocumentDeleted"));
    } catch (err) {
      const error = asError(err);
      captureException(error);
      notifyError(error.message);
    } finally {
      setDeletingDocId(null);
    }
  };

  const handleMoveDoc = async (docId: string, targetCollectionId: string) => {
    setMovingDocId(docId);
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
      setMovingDocId(null);
      setMoveCollectionId("");
    }
  };

  const openMoveDialog = (docId: string) => {
    setMovingDocId(docId);
    setMoveCollectionId("");
    setShowMoveDialog(true);
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface className="min-w-[680px] max-w-[840px] max-h-[80vh]">
        <DialogBody>
          <DialogTitle>
            {t("Knowledge.ImportTaskPanel.Title", { defaultValue: "Import Tasks" })}
          </DialogTitle>
          <DialogContent>
            <div className="flex flex-col gap-4">
              <div className="flex gap-6 p-3 bg-gray-50 rounded-lg flex-wrap">
                <StatItem
                  label={t("Knowledge.ImportTaskPanel.Jobs", { defaultValue: "Jobs" })}
                  value={totalStats.total}
                  icon={<ProcessingIcon fontSize={16} className="text-blue-500" />}
                />
                <StatItem
                  label={t("Document.Status.Pending")}
                  value={totalStats.pending}
                  icon={<PendingIcon fontSize={16} className="text-gray-500" />}
                />
                <StatItem
                  label={t("Document.Status.Processing")}
                  value={totalStats.processing}
                  icon={<Spinner size="extra-tiny" />}
                />
                <StatItem
                  label={t("Document.Status.Completed")}
                  value={totalStats.completed}
                  icon={<SuccessIcon fontSize={16} className="text-green-500" />}
                />
                <StatItem
                  label={t("Document.Status.Failed")}
                  value={totalStats.failed}
                  icon={<ErrorIcon fontSize={16} className="text-red-500" />}
                />
              </div>

              <div className="border rounded-lg max-h-[480px] overflow-y-auto">
                {jobs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                    <SuccessIcon fontSize={36} className="text-green-400 mb-3" />
                    <p className="text-sm">
                      {t("Knowledge.ImportTaskPanel.NoJobs", {
                        defaultValue: "No active import jobs",
                      })}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {jobs.map((job) => {
                      const isActive = job.id === activeJobId;
                      const expanded = isActive || expandedJobs.has(job.id);
                      return (
                        <div key={job.id} className={isActive ? "bg-blue-50" : ""}>
                          <JobHeader
                            job={job}
                            expanded={expanded}
                            onToggle={() => toggleJobExpanded(job.id)}
                            onRetryJob={() => handleRetryJob(job.id)}
                            isRetrying={retryingJobId === job.id}
                          />
                          {expanded && (
                            <div className="divide-y bg-gray-50/50">
                              {Object.values(job.documents).map((doc) => (
                                <TaskRow
                                  key={doc.id}
                                  document={doc}
                                  onRetry={() => handleRetryDoc(doc.id)}
                                  onDelete={() => setDeletingDocId(doc.id)}
                                  onMove={() => openMoveDialog(doc.id)}
                                  isRetrying={retryingDocId === doc.id}
                                  isMoving={movingDocId === doc.id}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
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
          open={!!deletingDocId}
          setOpen={() => setDeletingDocId(null)}
          message={t("Knowledge.Confirmation.DeleteDocument")}
          onConfirm={() => deletingDocId && handleDeleteDoc(deletingDocId)}
        />

        {showMoveDialog && movingDocId && (
          <MoveCollectionDialog
            open={showMoveDialog}
            onOpenChange={setShowMoveDialog}
            collections={collections.rows.filter((c) => c.id !== id)}
            selectedCollectionId={moveCollectionId}
            onSelectedChange={setMoveCollectionId}
            onConfirm={() => moveCollectionId && handleMoveDoc(movingDocId, moveCollectionId)}
            isMoving={!!movingDocId}
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

function JobHeader({
  job,
  expanded,
  onToggle,
  onRetryJob,
  isRetrying,
}: {
  job: ImportJob;
  expanded: boolean;
  onToggle: () => void;
  onRetryJob: () => void;
  isRetrying: boolean;
}) {
  const { t } = useTranslation();

  const statusInfo = {
    processing: {
      label: t("Document.Status.Processing"),
      color: "text-blue-600",
      dot: "bg-blue-500",
    },
    completed: {
      label: t("Document.Status.Completed"),
      color: "text-green-600",
      dot: "bg-green-500",
    },
    completed_with_errors: {
      label: t("Knowledge.ImportTaskPanel.CompletedWithErrors", {
        defaultValue: "Completed with errors",
      }),
      color: "text-orange-600",
      dot: "bg-orange-500",
    },
  }[job.status];

  const totalDocs = Object.keys(job.documents).length;

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer" onClick={onToggle}>
      <Button icon={expanded ? <ChevronDown /> : <ChevronRight />} appearance="subtle" size="small" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusInfo.dot}`} />
          <span className="text-sm font-medium truncate">{job.collectionName}</span>
          <span className="text-xs text-gray-400 flex-shrink-0">
            {totalDocs} {t("Knowledge.ImportTaskPanel.Files", { defaultValue: "files" })}
          </span>
          <span className="text-xs text-gray-400 flex-shrink-0">· {formatTime(job.createTime)}</span>
        </div>
        <div className="flex items-center gap-3 mt-1.5">
          <div className="flex-1 max-w-xs">
            <ProgressBar value={job.progress} />
          </div>
          <span className="text-xs text-gray-500 w-12 text-right">
            {(job.progress * 100).toFixed(0)}%
          </span>
          <span className={`text-xs font-medium ${statusInfo.color}`}>{statusInfo.label}</span>
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span>{job.pendingCount}P</span>
            <span>·</span>
            <span>{job.processingCount}R</span>
            <span>·</span>
            <span className="text-green-600">{job.completedCount}C</span>
            {job.failedCount > 0 && (
              <>
                <span>·</span>
                <span className="text-red-600">{job.failedCount}F</span>
              </>
            )}
          </div>
        </div>
      </div>
      {job.failedCount > 0 && (
        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <Button
            appearance="primary"
            size="small"
            icon={<RetryIcon />}
            onClick={onRetryJob}
            disabled={isRetrying}
          >
            {t("Knowledge.ImportTaskPanel.RetryFailed", { defaultValue: "Retry Failed" })}
          </Button>
        </div>
      )}
    </div>
  );
}

function TaskRow({
  document,
  onRetry,
  onDelete,
  onMove,
  isRetrying,
  isMoving,
}: {
  document: ImportJob["documents"][string];
  onRetry: () => void;
  onDelete: () => void;
  onMove: () => void;
  isRetrying: boolean;
  isMoving: boolean;
}) {
  const { t } = useTranslation();

  const status = getTaskStatus(document);
  const progress = document.progress || 0;

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
    <div className="flex items-center gap-3 pl-10 pr-4 py-2.5 hover:bg-gray-100">
      <div className="flex-shrink-0 w-6">{statusInfo.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{document.name}</span>
          <span className="text-xs text-gray-400 flex-shrink-0">{formatFileSize(document.size)}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-xs ${statusInfo.color}`}>{statusInfo.label}</span>
          {isProcessing && (
            <span className="text-xs text-gray-500">{(progress * 100).toFixed(0)}%</span>
          )}
          {document.status === "failed" && document.error && (
            <Tooltip relationship="description" content={document.error}>
              <WarningIcon fontSize={12} className="text-orange-500" />
            </Tooltip>
          )}
        </div>
        {isProcessing && (
          <div className="w-full max-w-xs mt-1">
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
                <MenuItem icon={<RetryIcon />} onClick={onRetry} disabled={isRetrying || isMoving}>
                  {t("Knowledge.ImportTaskPanel.Retry", { defaultValue: "Retry" })}
                </MenuItem>
                <MenuItem icon={<MoveIcon />} onClick={onMove} disabled={isRetrying || isMoving}>
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
            {t("Knowledge.ImportTaskPanel.MoveTitle", { defaultValue: "Move to Collection" })}
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
