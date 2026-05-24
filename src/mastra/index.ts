
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { asoAuditAgent } from './agents/aso-audit-agent';
import { asoAuditWorkflow } from './workflows/aso-audit-workflow';

export const mastra = new Mastra({
	storage: new LibSQLStore({
		id: 'mastra-storage',
		url: 'file:./mastra.db',
	}),
	agents: { asoAuditAgent },
	workflows: { asoAuditWorkflow },
});
        