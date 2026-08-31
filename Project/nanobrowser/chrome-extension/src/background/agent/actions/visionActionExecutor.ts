/**
 * Vision Action Executor — Module 4
 *
 * Receives the action list returned by the ShieldBrowse server and
 * executes each action using the existing Puppeteer Page object.
 */

import type Page from '../../browser/page';
import { createLogger } from '../../log';
import type { AgentAction } from '../../services/serverClient';

const logger = createLogger('VisionActionExecutor');

export interface ExecutionResult {
  actionsAttempted: number;
  actionsSucceeded: number;
  errors: string[];
}

/**
 * Executes a list of actions returned by the ShieldBrowse server.
 *
 * @param actions - Parsed action list from server
 * @param page    - Puppeteer Page wrapper from BrowserContext
 */
export async function executeActions(
  actions: AgentAction[],
  page: Page,
): Promise<ExecutionResult> {
  const result: ExecutionResult = {
    actionsAttempted: actions.length,
    actionsSucceeded: 0,
    errors: [],
  };

  for (const action of actions) {
    try {
      await executeSingleAction(action, page);
      result.actionsSucceeded++;
      logger.info(`Executed [${action.type}]`, action);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warning(`Action [${action.type}] failed:`, msg);
      result.errors.push(`${action.type}: ${msg}`);
    }
  }

  return result;
}

async function executeSingleAction(action: AgentAction, page: Page): Promise<void> {
  // Access the underlying puppeteer page
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const puppeteerPage = (page as any)._puppeteerPage ?? (page as any).page;

  if (!puppeteerPage) {
    throw new Error('No puppeteer page available');
  }

  switch (action.type) {
    case 'click': {
      if (!action.selector) throw new Error('click requires selector');
      await puppeteerPage.click(action.selector);
      break;
    }

    case 'type': {
      if (!action.selector) throw new Error('type requires selector');
      if (!action.value) throw new Error('type requires value');
      await puppeteerPage.click(action.selector);
      await puppeteerPage.type(action.selector, action.value, { delay: 30 });
      break;
    }

    case 'scroll': {
      const amount = action.amount ?? 300;
      const dir = action.direction ?? 'down';
      const deltaX = dir === 'left' ? -amount : dir === 'right' ? amount : 0;
      const deltaY = dir === 'up' ? -amount : dir === 'down' ? amount : 0;
      await puppeteerPage.evaluate(
        (dx: number, dy: number) => window.scrollBy(dx, dy),
        deltaX,
        deltaY,
      );
      break;
    }

    case 'navigate': {
      if (!action.url) throw new Error('navigate requires url');
      await puppeteerPage.goto(action.url, { waitUntil: 'domcontentloaded' });
      break;
    }

    case 'wait': {
      const ms = action.ms ?? 1000;
      await new Promise(resolve => setTimeout(resolve, ms));
      break;
    }

    default:
      logger.warning('Unknown action type:', (action as AgentAction).type);
  }
}
