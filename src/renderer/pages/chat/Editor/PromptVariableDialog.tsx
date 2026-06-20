import {
  Dialog,
  DialogTrigger,
  Button,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  Field,
  Input,
  DialogActions,
  Textarea,
  InfoLabel,
  Divider,
  Text,
} from '@fluentui/react-components';
import { Dismiss24Regular, Eye20Regular } from '@fluentui/react-icons';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IPromptVariableSchema } from 'intellichat/types';
import { fillVariables } from 'utils/util';

export default function PromptVariableDialog(args: {
  open: boolean;
  systemVariables: string[];
  userVariables: string[];
  systemVariableSchemas?: IPromptVariableSchema[];
  userVariableSchemas?: IPromptVariableSchema[];
  systemMessage?: string;
  userMessage?: string;
  onCancel: () => void;
  onConfirm: (
    systemVars: { [key: string]: string },
    userVars: { [key: string]: string },
  ) => void;
}) {
  const { t } = useTranslation();
  const {
    open,
    systemVariables,
    userVariables,
    systemVariableSchemas = [],
    userVariableSchemas = [],
    systemMessage = '',
    userMessage = '',
    onCancel,
    onConfirm,
  } = args;

  const [systemVars, setSystemVars] = useState<{ [key: string]: string }>({});
  const [userVars, setUserVars] = useState<{ [key: string]: string }>({});
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (open) {
      const defaults: { [key: string]: string } = {};
      systemVariableSchemas.forEach((s) => {
        if (s.defaultValue) defaults[s.name] = s.defaultValue;
      });
      setSystemVars(defaults);
    }
  }, [open, systemVariableSchemas]);

  useEffect(() => {
    if (open) {
      const defaults: { [key: string]: string } = {};
      userVariableSchemas.forEach((s) => {
        if (s.defaultValue) defaults[s.name] = s.defaultValue;
      });
      setUserVars(defaults);
    }
  }, [open, userVariableSchemas]);

  const getSystemSchema = (name: string): IPromptVariableSchema | undefined => {
    return systemVariableSchemas.find((s) => s.name === name);
  };

  const getUserSchema = (name: string): IPromptVariableSchema | undefined => {
    return userVariableSchemas.find((s) => s.name === name);
  };

  const onSystemVariesChange = (key: string, value: string) => {
    setSystemVars({ ...systemVars, [key]: value });
  };

  const onUserVariesChange = (key: string, value: string) => {
    setUserVars({ ...userVars, [key]: value });
  };

  const handleConfirm = () => {
    onConfirm(systemVars, userVars);
    setSystemVars({});
    setUserVars({});
  };

  const previewSystemMessage = useMemo(() => {
    return fillVariables(systemMessage, systemVars);
  }, [systemMessage, systemVars]);

  const previewUserMessage = useMemo(() => {
    return fillVariables(userMessage, userVars);
  }, [userMessage, userVars]);

  if (!open) return null;

  return (
    <Dialog open={open}>
      <DialogSurface style={{ maxWidth: 720 }}>
        <DialogBody>
          <DialogTitle
            action={
              <DialogTrigger action="close">
                <Button
                  appearance="subtle"
                  aria-label="close"
                  icon={<Dismiss24Regular />}
                  onClick={onCancel}
                />
              </DialogTrigger>
            }
          >
            {t('Prompt.FillVariables')}
          </DialogTitle>
          <DialogContent>
            <div>
              {systemVariables.length ? (
                <div className="mb-4">
                  <div className="text-base font-medium">
                    {t('Common.SystemMessage')}
                    {t('Common.Variables')}
                  </div>
                  {systemVariables.map((variable) => {
                    const schema = getSystemSchema(variable);
                    return (
                      <Field
                        label={
                          <InfoLabel info={schema?.description}>
                            {variable}
                            {schema?.required && (
                              <span className="text-colorPaletteRedBackground1">
                                {' '}
                                *
                              </span>
                            )}
                          </InfoLabel>
                        }
                        key={`system-var-${variable}`}
                        className="my-2"
                      >
                        <Textarea
                          className="w-full"
                          value={systemVars[variable] || ''}
                          placeholder={
                            schema?.defaultValue || t('Common.Required')
                          }
                          onChange={(e) =>
                            onSystemVariesChange(variable, e.target.value || '')
                          }
                        />
                      </Field>
                    );
                  })}
                </div>
              ) : null}
              {userVariables.length ? (
                <div>
                  <div className="text-base font-medium">
                    {t('Common.UserMessage')}
                    {t('Common.Variables')}
                  </div>
                  {userVariables.map((variable) => {
                    const schema = getUserSchema(variable);
                    return (
                      <Field
                        label={
                          <InfoLabel info={schema?.description}>
                            {variable}
                            {schema?.required && (
                              <span className="text-colorPaletteRedBackground1">
                                {' '}
                                *
                              </span>
                            )}
                          </InfoLabel>
                        }
                        key={`user-var-${variable}`}
                        className="my-2"
                      >
                        <Textarea
                          className="w-full"
                          value={userVars[variable] || ''}
                          placeholder={
                            schema?.defaultValue || t('Common.Required')
                          }
                          onChange={(e) =>
                            onUserVariesChange(variable, e.target.value || '')
                          }
                        />
                      </Field>
                    );
                  })}
                </div>
              ) : null}
              <div className="mt-4">
                <Button
                  appearance="subtle"
                  icon={<Eye20Regular />}
                  onClick={() => setShowPreview(!showPreview)}
                >
                  {showPreview
                    ? t('Prompt.HidePreview')
                    : t('Prompt.ShowPreview')}
                </Button>
              </div>
              {showPreview && (
                <div className="mt-4">
                  <Divider>{t('Common.Preview')}</Divider>
                  {systemMessage && (
                    <div className="mt-3">
                      <Text size={200} className="text-color-secondary block mb-1">
                        {t('Common.SystemMessage')}:
                      </Text>
                      <div className="p-3 bg-colorNeutralBackground3 rounded whitespace-pre-wrap">
                        {previewSystemMessage}
                      </div>
                    </div>
                  )}
                  {userMessage && (
                    <div className="mt-3">
                      <Text size={200} className="text-color-secondary block mb-1">
                        {t('Common.UserMessage')}:
                      </Text>
                      <div className="p-3 bg-colorNeutralBackground3 rounded whitespace-pre-wrap">
                        {previewUserMessage}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="subtle" onClick={onCancel}>
                {t('Common.Cancel')}
              </Button>
            </DialogTrigger>
            <Button appearance="primary" onClick={handleConfirm}>
              {t('Common.OK')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
