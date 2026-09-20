import 'webextension-polyfill';
import {
  agentModelStore,
  AgentNameEnum,
  firewallStore,
  generalSettingsStore,
  llmProviderStore,
  analyticsSettingsStore,
} from '@extension/storage';
import { t } from '@extension/i18n';
import BrowserContext from './browser/context';
import { Executor } from './agent/executor';
import { createLogger } from './log';
import { ExecutionState } from './agent/event/types';
import { createChatModel } from './agent/helper';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DEFAULT_AGENT_OPTIONS } from './agent/types';
import { SpeechToTextService } from './services/speechToText';
import { injectBuildDomTreeScripts } from './browser/dom/service';
import { analytics } from './services/analytics';
import { VisionPipeline } from './vision/pipeline';
import { sanitizeScreenshot } from './vision/sanitizeScreenshot';
import { checkServerHealth } from './services/serverClient';
import { resolveGuardianConfirmation } from './agent/actions/liveActionGuardian';
import { credentialStore } from './privacy/credentialStore';
import type { TokenType } from './privacy/credentialStore';

const logger = createLogger('background');

const browserContext = new BrowserContext({});
let currentExecutor: Executor | null = null;
let currentPort: chrome.runtime.Port | null = null;
const SIDE_PANEL_URL = chrome.runtime.getURL('side-panel/index.html');

/**
 * Runs the full ShieldBrowse Vision Pipeline for any user task.
 * Called automatically (non-blocking) at the start of every new_task / follow_up_task.
 * Broadcasts vision_task_started → vision_task_result (or error) to the SidePanel.
 */
async function runVisionScanForTask(task: string, port: chrome.runtime.Port): Promise<void> {
  const pipeline = new VisionPipeline(browserContext);
  try {
    port.postMessage({ type: 'vision_task_started' });

    // Pre-capture screenshot via Chrome native API (works without an active Puppeteer session).
    // Service workers have no "currentWindow" — query all windows for the active http tab.
    let preScreenshot: string | undefined;
    try {
      const allTabs = await chrome.tabs.query({ active: true });
      const activeTab = allTabs.find(t => t.url?.startsWith('http') && t.windowId);
      if (activeTab?.windowId) {
        const dataUrl = await chrome.tabs.captureVisibleTab(activeTab.windowId, { format: 'jpeg', quality: 80 });
        preScreenshot = dataUrl.replace(/^data:[^;]+;base64,/, '');
        logger.info('[AutoVision] Screenshot captured via captureVisibleTab ✅');
      }
    } catch (screenshotErr) {
      logger.warning('[AutoVision] captureVisibleTab failed, pipeline will try Puppeteer:', screenshotErr);
    }

    const result = await pipeline.run(task, {
      enableFaceDetection: true,
      enableDomExtraction: true,
      skipExecution: true,   // Vision scan only — actions are handled by the text executor
      screenshotB64: preScreenshot,
      onGuardianAlert: (payload) => {
        try {
          port.postMessage(payload);
          logger.info('[Guardian] Alert broadcast to SidePanel:', payload.checkId);
        } catch (e) {
          logger.warning('[Guardian] Failed to broadcast alert to SidePanel:', String(e));
        }
      },
    });

    port.postMessage({ type: 'vision_task_result', result });
    logger.info(
      `[AutoVision] Scan complete — ${result.detectionReport?.facesFound ?? 0} faces, ` +
      `${result.detectionReport?.domFieldsFound ?? 0} PII fields, ` +
      `${result.redactionReport?.totalRegions ?? 0} regions redacted`,
    );
  } catch (err) {
    // Vision scan failure is non-fatal — log it, don't interrupt the text agent.
    logger.warning('[AutoVision] Vision scan failed (non-fatal):', err instanceof Error ? err.message : String(err));
    try {
      port.postMessage({ type: 'vision_task_result', result: { success: false, error: String(err), durationMs: 0 } });
    } catch { /* port may have closed */ }
  }
}

// Setup side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => console.error(error));

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId && changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    await injectBuildDomTreeScripts(tabId);
  }
});

// Listen for debugger detached event
// if canceled_by_user, remove the tab from the browser context
chrome.debugger.onDetach.addListener(async (source, reason) => {
  console.log('Debugger detached:', source, reason);
  if (reason === 'canceled_by_user') {
    if (source.tabId) {
      currentExecutor?.cancel();
      await browserContext.cleanup();
    }
  }
});

// Cleanup when tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  browserContext.removeAttachedPage(tabId);
});

logger.info('background loaded');

// Initialize analytics
analytics.init().catch(error => {
  logger.error('Failed to initialize analytics:', error);
});

// Listen for analytics settings changes
analyticsSettingsStore.subscribe(() => {
  analytics.updateSettings().catch(error => {
    logger.error('Failed to update analytics settings:', error);
  });
});

// Listen for simple messages (e.g., from options page or vault modal)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'vault_get_all') {
    credentialStore.getAll()
      .then(entries => sendResponse({ success: true, entries }))
      .catch(err => sendResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to load vault' }));
    return true; // asynchronous
  }

  if (message?.type === 'vault_save') {
    const { label, tokenType, value: credValue, existingId } = message as {
      label: string;
      tokenType: TokenType;
      value: string;
      existingId?: string;
    };
    if (!label || !tokenType || !credValue) {
      sendResponse({ success: false, error: 'vault_save: label, tokenType, and value are required' });
      return false;
    }
    credentialStore.save(label, tokenType, credValue, existingId)
      .then(saved => {
        logger.info(`[Vault] Credential saved via onMessage: ${label} (${tokenType}) id=${saved.id}`);
        sendResponse({ success: true, entry: saved });
      })
      .catch(err => sendResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to save credential' }));
    return true; // asynchronous
  }

  if (message?.type === 'vault_delete') {
    const { id: credId } = message as { id: string };
    if (!credId) {
      sendResponse({ success: false, error: 'vault_delete: id is required' });
      return false;
    }
    credentialStore.delete(credId)
      .then(() => {
        logger.info(`[Vault] Credential deleted via onMessage: ${credId}`);
        sendResponse({ success: true, id: credId });
      })
      .catch(err => sendResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to delete credential' }));
    return true; // asynchronous
  }

  if (message?.type === 'TRIGGER_VISUAL_SCAN') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        // Filter out extension internal tabs if possible
        const targetTab = tabs.find(t => t.url && !t.url.startsWith('chrome-extension://')) || tabs[0];
        if (!targetTab?.id) {
          sendResponse({ success: false, error: 'No active web page tab found' });
          return;
        }

        const screenshot = await chrome.tabs.captureVisibleTab(targetTab.windowId, { format: 'jpeg', quality: 90 });
        const sanitized = await sanitizeScreenshot({
          screenshotB64: screenshot,
          mimeType: 'image/jpeg',
          tabId: targetTab.id,
          pageUrl: targetTab.url,
          pageTitle: targetTab.title,
        });

        sendResponse({
          success: true,
          rawImage: screenshot,
          sanitizedImage: `data:image/png;base64,${sanitized.sanitizedImageB64}`,
          redactionReport: sanitized.redactionReport,
          detectionReport: sanitized.detectionReport,
          classification: sanitized.classification,
          pageUrl: targetTab.url,
          pageTitle: targetTab.title,
        });
      } catch (err) {
        logger.error('[TRIGGER_VISUAL_SCAN] error:', err);
        sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true; // asynchronous
  }

  return false;
});

// Setup connection listener for long-lived connections (e.g., side panel)
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'side-panel-connection') {
    const senderUrl = port.sender?.url;
    const senderId = port.sender?.id;

    if (!senderUrl || senderId !== chrome.runtime.id || senderUrl !== SIDE_PANEL_URL) {
      logger.warning('Blocked unauthorized side-panel-connection', senderId, senderUrl);
      port.disconnect();
      return;
    }

    currentPort = port;

    port.onMessage.addListener(async message => {
      try {
        switch (message.type) {
          case 'heartbeat':
            // Acknowledge heartbeat
            port.postMessage({ type: 'heartbeat_ack' });
            break;

          case 'new_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: t('bg_cmd_newTask_noTask') });
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });

            logger.info('new_task', message.tabId, message.task);

            // 🛡️ Auto-fire Vision Pipeline on every task (non-blocking).
            // Runs in parallel with the text LLM agent — does not delay execution.
            // skipExecution=true so vision scan only detects/redacts; text agent handles DOM actions.
            runVisionScanForTask(message.task, port).catch(err =>
              logger.warning('[AutoVision] Unhandled vision scan error:', String(err))
            );

            currentExecutor = await setupExecutor(message.taskId, message.task, browserContext);
            subscribeToExecutorEvents(currentExecutor);

            const result = await currentExecutor.execute();
            logger.info('new_task execution result', message.tabId, result);
            break;
          }

          case 'follow_up_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: t('bg_cmd_followUpTask_noTask') });
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });

            logger.info('follow_up_task', message.tabId, message.task);

            // 🛡️ Auto-fire Vision Pipeline on every follow-up task too (non-blocking).
            runVisionScanForTask(message.task, port).catch(err =>
              logger.warning('[AutoVision] Unhandled vision scan error (follow-up):', String(err))
            );

            // If executor exists, add follow-up task; otherwise initialize new executor seamlessly
            if (currentExecutor) {
              currentExecutor.addFollowUpTask(message.task);
            } else {
              logger.info('follow_up_task: setting up fresh executor for task');
              currentExecutor = await setupExecutor(message.taskId || Date.now().toString(), message.task, browserContext);
            }
            subscribeToExecutorEvents(currentExecutor);
            const result = await currentExecutor.execute();
            logger.info('follow_up_task execution result', message.tabId, result);
            break;
          }

          case 'cancel_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            await currentExecutor.cancel();
            break;
          }

          case 'resume_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_cmd_resumeTask_noTask') });
            await currentExecutor.resume();
            return port.postMessage({ type: 'success' });
          }

          case 'pause_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            await currentExecutor.pause();
            return port.postMessage({ type: 'success' });
          }

          case 'screenshot': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            const page = await browserContext.switchTab(message.tabId);
            const screenshot = await page.takeScreenshot();
            logger.info('screenshot', message.tabId, screenshot);
            return port.postMessage({ type: 'success', screenshot });
          }

          case 'state': {
            try {
              const browserState = await browserContext.getState(true);
              const elementsText = browserState.elementTree.clickableElementsToString(
                DEFAULT_AGENT_OPTIONS.includeAttributes,
              );

              logger.info('state', browserState);
              logger.info('interactive elements', elementsText);
              return port.postMessage({ type: 'success', msg: t('bg_cmd_state_printed') });
            } catch (error) {
              logger.error('Failed to get state:', error);
              return port.postMessage({ type: 'error', error: t('bg_cmd_state_failed') });
            }
          }

          case 'nohighlight': {
            const page = await browserContext.getCurrentPage();
            await page.removeHighlight();
            return port.postMessage({ type: 'success', msg: t('bg_cmd_nohighlight_ok') });
          }

          case 'speech_to_text': {
            try {
              if (!message.audio) {
                return port.postMessage({
                  type: 'speech_to_text_error',
                  error: t('bg_cmd_stt_noAudioData'),
                });
              }

              logger.info('Processing speech-to-text request...');

              // Get all providers for speech-to-text service
              const providers = await llmProviderStore.getAllProviders();

              // Create speech-to-text service with all providers
              const speechToTextService = await SpeechToTextService.create(providers);

              // Extract base64 audio data (remove data URL prefix if present)
              let base64Audio = message.audio;
              if (base64Audio.startsWith('data:')) {
                base64Audio = base64Audio.split(',')[1];
              }

              // Transcribe audio
              const transcribedText = await speechToTextService.transcribeAudio(base64Audio);

              logger.info('Speech-to-text completed successfully');
              return port.postMessage({
                type: 'speech_to_text_result',
                text: transcribedText,
              });
            } catch (error) {
              logger.error('Speech-to-text failed:', error);
              return port.postMessage({
                type: 'speech_to_text_error',
                error: error instanceof Error ? error.message : t('bg_cmd_stt_failed'),
              });
            }
          }

          case 'replay': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            if (!message.taskId) return port.postMessage({ type: 'error', error: t('bg_errors_noTaskId') });
            if (!message.historySessionId)
              return port.postMessage({ type: 'error', error: t('bg_cmd_replay_noHistory') });
            logger.info('replay', message.tabId, message.taskId, message.historySessionId);

            try {
              // Switch to the specified tab
              await browserContext.switchTab(message.tabId);
              // Setup executor with the new taskId and a dummy task description
              currentExecutor = await setupExecutor(message.taskId, message.task, browserContext);
              subscribeToExecutorEvents(currentExecutor);

              // Run replayHistory with the history session ID
              const result = await currentExecutor.replayHistory(message.historySessionId);
              logger.debug('replay execution result', message.tabId, result);
            } catch (error) {
              logger.error('Replay failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : t('bg_cmd_replay_failed'),
              });
            }
            break;
          }

          case 'vision_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: 'No task provided for vision pipeline' });
            const pipeline = new VisionPipeline(browserContext);
            port.postMessage({ type: 'vision_task_started' });
            try {
              // Pre-capture screenshot using Chrome native API.
              // This works even without an active Puppeteer session.
              // Note: service workers have no "current window", so query all windows.
              let preScreenshot: string | undefined;
              try {
                const allTabs = await chrome.tabs.query({ active: true });
                const activeTab = allTabs.find(t => t.url?.startsWith('http') && t.windowId);
                if (activeTab?.windowId) {
                  const dataUrl = await chrome.tabs.captureVisibleTab(activeTab.windowId, { format: 'jpeg', quality: 80 });
                  preScreenshot = dataUrl.replace(/^data:[^;]+;base64,/, '');
                  logger.info('[vision_task] Screenshot captured via captureVisibleTab ✅');
                }
              } catch (screenshotErr) {
                logger.warning('[vision_task] captureVisibleTab failed, pipeline will try Puppeteer:', screenshotErr);
              }

              const result = await pipeline.run(message.task, {
                enableFaceDetection: message.enableFaceDetection ?? true,
                enableDomExtraction: message.enableDomExtraction ?? true,
                skipExecution: message.skipExecution ?? false,
                screenshotB64: preScreenshot, // pass pre-captured screenshot
                // Task 3B: Wire Guardian alert broadcaster → SidePanel port
                onGuardianAlert: (payload) => {
                  try {
                    port.postMessage(payload);
                    logger.info('[Guardian] Alert broadcast to SidePanel:', payload.checkId);
                  } catch (e) {
                    logger.warning('[Guardian] Failed to broadcast alert to SidePanel:', String(e));
                  }
                },
              });
              return port.postMessage({ type: 'vision_task_result', result });
            } catch (err) {
              return port.postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
            }
          }


          case 'action_guardian_response': {
            // Task 3B: User approved or blocked a Guardian drift alert
            // message.checkId — the unique check ID from the alert
            // message.approved — true = proceed, false = block
            const { checkId, approved } = message as { checkId: string; approved: boolean };
            resolveGuardianConfirmation(checkId, !!approved);
            logger.info(`[Guardian] User response for ${checkId}: ${approved ? 'APPROVED' : 'BLOCKED'}`);
            return port.postMessage({ type: 'success' });
          }

          case 'server_health': {
            const healthy = await checkServerHealth();
            return port.postMessage({ type: 'server_health_result', healthy });
          }

          // ――― Personal Credential Vault handlers ―――――――――――――――――――――――――――――――――――
          case 'vault_get_all': {
            // Returns all credential entries (no decryption — UI only needs hints).
            const entries = await credentialStore.getAll();
            return port.postMessage({ type: 'vault_all', entries });
          }

          case 'vault_save': {
            // message.label, message.tokenType, message.value, message.existingId (optional)
            const { label, tokenType, value: credValue, existingId } = message as {
              label: string;
              tokenType: TokenType;
              value: string;
              existingId?: string;
            };
            if (!label || !tokenType || !credValue) {
              return port.postMessage({ type: 'error', error: 'vault_save: label, tokenType, and value are required' });
            }
            const saved = await credentialStore.save(label, tokenType, credValue, existingId);
            logger.info(`[Vault] Credential saved: ${label} (${tokenType}) id=${saved.id}`);
            return port.postMessage({ type: 'vault_saved', entry: saved });
          }

          case 'vault_delete': {
            // message.id — the credential id to remove
            const { id: credId } = message as { id: string };
            if (!credId) return port.postMessage({ type: 'error', error: 'vault_delete: id is required' });
            await credentialStore.delete(credId);
            logger.info(`[Vault] Credential deleted: ${credId}`);
            return port.postMessage({ type: 'vault_deleted', id: credId });
          }

          default:
            return port.postMessage({ type: 'error', error: t('errors_cmd_unknown', [message.type]) });
        }
      } catch (error) {
        console.error('Error handling port message:', error);
        port.postMessage({
          type: 'error',
          error: error instanceof Error ? error.message : t('errors_unknown'),
        });
      }
    });

    port.onDisconnect.addListener(() => {
      // this event is also triggered when the side panel is closed, so we need to cancel the task
      console.log('Side panel disconnected');
      currentPort = null;
      currentExecutor?.cancel();
    });
  }
});

async function setupExecutor(taskId: string, task: string, browserContext: BrowserContext) {
  const providers = await llmProviderStore.getAllProviders();
  // if no providers, need to display the options page
  if (Object.keys(providers).length === 0) {
    throw new Error(t('bg_setup_noApiKeys'));
  }

  // Clean up any legacy validator settings for backward compatibility
  await agentModelStore.cleanupLegacyValidatorSettings();

  const agentModels = await agentModelStore.getAllAgentModels();
  // verify if every provider used in the agent models exists in the providers
  for (const agentModel of Object.values(agentModels)) {
    if (!providers[agentModel.provider]) {
      throw new Error(t('bg_setup_noProvider', [agentModel.provider]));
    }
  }

  const navigatorModel = agentModels[AgentNameEnum.Navigator];
  if (!navigatorModel) {
    throw new Error(t('bg_setup_noNavigatorModel'));
  }
  // Log the provider config being used for the navigator
  const navigatorProviderConfig = providers[navigatorModel.provider];
  const navigatorLLM = createChatModel(navigatorProviderConfig, navigatorModel);

  let plannerLLM: BaseChatModel | null = null;
  const plannerModel = agentModels[AgentNameEnum.Planner];
  if (plannerModel) {
    // Log the provider config being used for the planner
    const plannerProviderConfig = providers[plannerModel.provider];
    plannerLLM = createChatModel(plannerProviderConfig, plannerModel);
  }

  // Apply firewall settings to browser context
  const firewall = await firewallStore.getFirewall();
  if (firewall.enabled) {
    browserContext.updateConfig({
      allowedUrls: firewall.allowList,
      deniedUrls: firewall.denyList,
    });
  } else {
    browserContext.updateConfig({
      allowedUrls: [],
      deniedUrls: [],
    });
  }

  const generalSettings = await generalSettingsStore.getSettings();
  browserContext.updateConfig({
    minimumWaitPageLoadTime: generalSettings.minWaitPageLoad / 1000.0,
    displayHighlights: generalSettings.displayHighlights,
  });

  const executor = new Executor(task, taskId, browserContext, navigatorLLM, {
    plannerLLM: plannerLLM ?? navigatorLLM,
    navigatorProvider: navigatorModel.provider,
    plannerProvider: plannerModel?.provider ?? navigatorModel.provider,
    agentOptions: {
      maxSteps: generalSettings.maxSteps,
      maxFailures: generalSettings.maxFailures,
      maxActionsPerStep: generalSettings.maxActionsPerStep,
      useVision: generalSettings.useVision,
      useVisionForPlanner: true,
      planningInterval: generalSettings.planningInterval,
    },
    generalSettings: generalSettings,
  });

  return executor;
}

// Update subscribeToExecutorEvents to use port
async function subscribeToExecutorEvents(executor: Executor) {
  // Clear previous event listeners to prevent multiple subscriptions
  executor.clearExecutionEvents();

  // Subscribe to new events
  executor.subscribeExecutionEvents(async event => {
    try {
      if (currentPort) {
        currentPort.postMessage(event);
      }
    } catch (error) {
      logger.error('Failed to send message to side panel:', error);
    }

    if (
      event.state === ExecutionState.TASK_OK ||
      event.state === ExecutionState.TASK_FAIL ||
      event.state === ExecutionState.TASK_CANCEL
    ) {
      await currentExecutor?.cleanup();
      currentExecutor = null;
    }
  });
}
