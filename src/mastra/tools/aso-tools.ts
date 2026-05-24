import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { appListingSchema, asoAuditWorkflow, auditOutputSchema, fetchListing, parseUrl } from '../workflows/aso-audit-workflow';

export const fetchAppMetadataTool = createTool({
  id: 'fetch-app-metadata',
  description:
    'Fetch basic App Store metadata from a user-provided Apple App Store URL so the user can confirm the target app before the full audit.',
  inputSchema: z.object({
    appUrl: z.string().url().describe('Apple App Store URL pasted by the user.'),
  }),
  outputSchema: z.object({
    app: appListingSchema,
    confirmationPrompt: z.string(),
  }),
  execute: async ({ appUrl }) => {
    const { trackId, country } = parseUrl(appUrl);
    const app = await fetchListing(trackId, country);

    return {
      app,
      confirmationPrompt: `Is this the app you meant? ${app.trackName} by ${app.sellerName} (${app.primaryGenreName}, ${app.country.toUpperCase()})`,
    };
  },
});

export const runAsoAuditTool = createTool({
  id: 'run-aso-audit',
  description:
    'Run a complete ASO audit workflow after the user confirms the app metadata. Returns weighted scorecard inputs and evidence for recommendations.',
  inputSchema: z.object({
    appUrl: z.string().url().describe('Confirmed Apple App Store URL.'),
    confirmed: z.boolean().describe('Must be true when user explicitly confirms this is the correct app.'),
  }),
  outputSchema: z.object({
    status: z.enum(['blocked', 'completed']),
    message: z.string(),
    progressLog: z.array(z.string()).optional(),
    auditData: auditOutputSchema.omit({ progressLog: true }).optional(),
  }),
  execute: async ({ appUrl, confirmed }) => {
    if (!confirmed) {
      return {
        status: 'blocked',
        message: 'Please confirm the app first. Call this tool only after the user says yes.',
      } as const;
    }

    const run = await asoAuditWorkflow.createRun();
    const result = await run.start({ inputData: { appUrl } });

    if (result.status !== 'success') {
      throw new Error(`ASO audit workflow failed with status: ${result.status}`);
    }

    return {
      status: 'completed',
      message: 'ASO audit completed.',
      progressLog: result.result.progressLog,
      auditData: {
        app: result.result.app,
        scoreCard: result.result.scoreCard,
        reviewsSummary: result.result.reviewsSummary,
        competitors: result.result.competitors,
      },
    } as const;
  },
});
