import type { PostgresMigrationRunbookV1 } from './postgres-runbook-types.js';

function checkbox(items: readonly string[]): string {
  return items.length > 0 ? items.map((item) => `- [ ] ${item}`).join('\n') : '- None';
}

function bullets(items: readonly string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- None';
}

export function renderPostgresMigrationRunbookMarkdown(
  runbook: PostgresMigrationRunbookV1,
): string {
  const checks = runbook.readiness.checks
    .map((check) => `- **${check.level.toUpperCase()} — ${check.code}:** ${check.message}`)
    .join('\n');
  const inputs = runbook.required_inputs
    .map(
      (input) =>
        `| \`${input.key}\` | ${input.label} | ${input.sensitive ? 'Yes' : 'No'} | \`${input.placeholder}\` | ${input.description} |`,
    )
    .join('\n');
  const phaseSections = runbook.phases
    .map((phase) => {
      const commands =
        phase.commands.length === 0
          ? '_No command template. Complete this phase through an approved operator or cloud workflow._'
          : phase.commands
              .map(
                (entry) =>
                  `#### ${entry.title}\n\nEffect: ${entry.mutates_target ? 'writes the target' : 'read-only'}; source mutation: no.\n\n\`\`\`sh\n${entry.shell}\n\`\`\``,
              )
              .join('\n\n');
      return `## ${String(phase.order)}. ${phase.title}\n\n${phase.objective}\n\n- Owner: operator\n- Downtime: ${phase.downtime}\n\n### Checklist\n\n${checkbox(phase.checklist)}\n\n### Command templates\n\n${commands}\n\n### Verification\n\n${checkbox(phase.verification)}\n\n### Rollback\n\n${bullets(phase.rollback)}`;
    })
    .join('\n\n');
  const references = runbook.references
    .map((reference) => `- [${reference.title}](${reference.url})`)
    .join('\n');

  return `# PostgreSQL Migration Runbook\n\nGenerated at: ${runbook.generated_at}\n\nProject: **${runbook.project.display_name}** (\`${runbook.project.id}\`)\n\nSource: **${runbook.source_service.name}** (\`${runbook.source_service.id}\`)\n\nTarget: **${runbook.target.display_name}**\n\nReadiness: **${runbook.readiness.status}**\n\n## Safety boundary\n\n- OpenLander executed no commands.\n- No credentials or secret values are included.\n- No cloud resources, application configuration, data, or DNS records were changed.\n- Every shell block is a template with unresolved placeholders and requires operator review.\n\n## Strategy\n\n- Method: \`${runbook.strategy.method}\`\n- Suitability: \`${runbook.strategy.suitability}\`\n- Write freeze required: yes\n- Online replication included: no\n- Database size: unknown until preflight\n- ${runbook.strategy.note}\n\n## Readiness checks\n\n${checks}\n\n## Required inputs\n\nDo not replace placeholders inside this document with secret values. Supply them only in an approved execution environment.\n\n| Key | Input | Sensitive | Example placeholder | Purpose |\n| --- | --- | --- | --- | --- |\n${inputs}\n\n${phaseSections}\n\n## Limitations\n\n${bullets(runbook.limitations)}\n\n## Official references\n\n${references}\n`;
}
