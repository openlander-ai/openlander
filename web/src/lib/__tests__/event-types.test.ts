import { describe, it, expect } from 'vitest';
import {
  toTimelineItem,
  agentEventToTimelineItem,
  sanitizeToolArguments,
  type BuildStreamEvent,
} from '../event-types.js';
import type { ChatStreamEvent } from '../../types/index.js';

describe('event-types', () => {
  describe('toTimelineItem', () => {
    describe('switch cases for BuildStreamEvent types', () => {
      it('converts log event to timeline item', () => {
        const event: BuildStreamEvent = {
          type: 'log',
          message: 'Build started',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
        };
        const result = toTimelineItem(event);
        expect(result.type).toBe('log');
        expect(result.title).toBe('Build started');
        expect(result.percent).toBe(-1);
      });

      it('converts complete event to success timeline item', () => {
        const event: BuildStreamEvent = {
          type: 'complete',
          message: 'Deploy complete in 45s — http://example.com',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
        };
        const result = toTimelineItem(event);
        expect(result.type).toBe('success');
        expect(result.title).toBe('Deploy complete in 45s — http://example.com');
        expect(result.percent).toBe(100);
        expect(result.url).toBe('http://example.com');
      });

      it('converts complete event without URL', () => {
        const event: BuildStreamEvent = {
          type: 'complete',
          message: 'Deploy complete',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
        };
        const result = toTimelineItem(event);
        expect(result.type).toBe('success');
        expect(result.url).toBeUndefined();
      });

      it('converts error event to error timeline item', () => {
        const event: BuildStreamEvent = {
          type: 'error',
          message: 'Build failed',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
          detail: 'Docker build error',
        };
        const result = toTimelineItem(event);
        expect(result.type).toBe('error');
        expect(result.title).toBe('Build failed');
        expect(result.detail).toBe('Docker build error');
        expect(result.percent).toBe(-1);
      });

      it('converts error event without detail', () => {
        const event: BuildStreamEvent = {
          type: 'error',
          message: 'Build failed',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
        };
        const result = toTimelineItem(event);
        expect(result.detail).toBeUndefined();
      });

      it('converts question_pending event', () => {
        const event: BuildStreamEvent = {
          type: 'question_pending',
          message: 'Need input',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
          questionId: 'q-1',
          questions: [
            {
              question: 'Which framework?',
              options: [
                { label: 'React', description: 'Frontend' },
                { label: 'Vue', description: 'Frontend' },
              ],
            },
          ],
        };
        const result = toTimelineItem(event);
        expect(result.type).toBe('question');
        expect(result.questionId).toBe('q-1');
        expect(result.questions).toHaveLength(1);
        expect(result.answered).toBe(false);
      });

      it('converts insight event with severity', () => {
        const event: BuildStreamEvent = {
          type: 'insight',
          message: 'Performance issue detected',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
          detail: 'High memory usage',
          severity: 'warning',
          actionButtons: [{ label: 'Optimize', action: 'optimize' }],
        };
        const result = toTimelineItem(event);
        expect(result.type).toBe('insight');
        expect(result.detail).toBe('High memory usage');
        expect(result.severity).toBe('warning');
        expect(result.actionButtons).toHaveLength(1);
      });

      it('converts insight event with default severity', () => {
        const event: BuildStreamEvent = {
          type: 'insight',
          message: 'Info message',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
        };
        const result = toTimelineItem(event);
        expect(result.severity).toBe('info');
      });

      it('converts dockerfile_fixed event', () => {
        const event: BuildStreamEvent = {
          type: 'dockerfile_fixed',
          message: 'Dockerfile fixed',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
          dockerfileChanges: ['Added RUN apt-get update', 'Added EXPOSE 3000'],
          retryCount: 2,
        };
        const result = toTimelineItem(event);
        expect(result.type).toBe('dockerfile_fixed');
        expect(result.dockerfileChanges).toHaveLength(2);
        expect(result.retryCount).toBe(2);
      });

      it('converts agent_thinking event', () => {
        const event: BuildStreamEvent = {
          type: 'agent_thinking',
          message: 'Analyzing error...',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
        };
        const result = toTimelineItem(event);
        expect(result.type).toBe('agent_thinking');
        expect(result.title).toBe('Analyzing error...');
      });

      it('converts agent_thinking event with empty message', () => {
        const event: BuildStreamEvent = {
          type: 'agent_thinking',
          message: '',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
        };
        const result = toTimelineItem(event);
        expect(result.title).toBe('Agent is analyzing...');
      });

      it('converts agent_tool_call event', () => {
        const event: BuildStreamEvent = {
          type: 'agent_tool_call',
          message: 'Calling tool',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
          toolName: 'docker_build',
          toolArguments: { image: 'myapp', tag: 'latest' },
        };
        const result = toTimelineItem(event);
        expect(result.type).toBe('agent_tool_call');
        expect(result.title).toBe('Calling docker_build');
        expect(result.toolName).toBe('docker_build');
        expect(result.toolArguments).toEqual({ image: 'myapp', tag: 'latest' });
      });

      it('converts agent_tool_call event without toolName', () => {
        const event: BuildStreamEvent = {
          type: 'agent_tool_call',
          message: 'Calling tool',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
        };
        const result = toTimelineItem(event);
        expect(result.title).toBe('Calling tool');
      });

      it('converts agent_tool_call event without toolArguments', () => {
        const event: BuildStreamEvent = {
          type: 'agent_tool_call',
          message: 'Calling tool',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
          toolName: 'docker_build',
        };
        const result = toTimelineItem(event);
        expect(result.toolArguments).toBeUndefined();
      });

      it('converts agent_tool_result event with success', () => {
        const event: BuildStreamEvent = {
          type: 'agent_tool_result',
          message: 'Tool executed',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
          toolName: 'docker_build',
          toolResult: { imageId: 'sha256:abc123' },
          toolSuccess: true,
        };
        const result = toTimelineItem(event);
        expect(result.type).toBe('agent_tool_result');
        expect(result.toolSuccess).toBe(true);
        expect(result.toolResult).toEqual({ imageId: 'sha256:abc123' });
      });

      it('converts agent_tool_result event with error', () => {
        const event: BuildStreamEvent = {
          type: 'agent_tool_result',
          message: 'Tool failed',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
          toolName: 'docker_build',
          toolSuccess: false,
          toolError: 'Build failed: out of memory',
        };
        const result = toTimelineItem(event);
        expect(result.toolSuccess).toBe(false);
        expect(result.toolError).toBe('Build failed: out of memory');
      });

      it('converts agent_message event', () => {
        const event: BuildStreamEvent = {
          type: 'agent_message',
          message: 'Fallback message',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
          content: 'Agent says: deployment successful',
        };
        const result = toTimelineItem(event);
        expect(result.type).toBe('agent_message');
        expect(result.title).toBe('Agent says: deployment successful');
      });

      it('converts agent_message event without content', () => {
        const event: BuildStreamEvent = {
          type: 'agent_message',
          message: 'Fallback message',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
        };
        const result = toTimelineItem(event);
        expect(result.title).toBe('Fallback message');
      });

      it('converts needs_user_action event', () => {
        const event: BuildStreamEvent = {
          type: 'needs_user_action',
          message: 'Action required',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
          category: 'approval',
          userDetail: 'Please review the changes',
        };
        const result = toTimelineItem(event);
        expect(result.type).toBe('needs_user_action');
        expect(result.category).toBe('approval');
        expect(result.detail).toBe('Please review the changes');
      });

      it('converts needs_user_action event with fallback detail', () => {
        const event: BuildStreamEvent = {
          type: 'needs_user_action',
          message: 'Action required',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
          detail: 'Fallback detail',
        };
        const result = toTimelineItem(event);
        expect(result.detail).toBe('Fallback detail');
      });

      it('converts unknown event type to progress', () => {
        const event: BuildStreamEvent = {
          type: 'status',
          message: 'Starting deployment',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
        };
        const result = toTimelineItem(event);
        expect(result.type).toBe('progress');
        expect(result.percent).toBe(0); // matches "starting deployment" pattern
      });
    });

    describe('progress estimation', () => {
      it('estimates progress from message patterns', () => {
        const testCases = [
          { message: 'starting deployment', expectedPercent: 0 },
          { message: 'cloning repository', expectedPercent: 25 },
          { message: 'docker image built', expectedPercent: 60 },
          { message: 'starting container', expectedPercent: 90 },
          { message: 'build in progress', expectedPercent: 10 },
          { message: 'unknown status', expectedPercent: 50 },
        ];

        for (const { message, expectedPercent } of testCases) {
          const event: BuildStreamEvent = {
            type: 'status',
            message,
            projectId: 'proj-1',
            timestamp: '2024-01-01T00:00:00Z',
          };
          const result = toTimelineItem(event);
          expect(result.percent).toBe(expectedPercent);
        }
      });

      it('uses explicit percent over estimation', () => {
        const event: BuildStreamEvent = {
          type: 'status',
          message: 'starting deployment',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
          percent: 75,
        };
        const result = toTimelineItem(event);
        expect(result.percent).toBe(75);
      });
    });

    describe('ID generation', () => {
      it('uses provided event ID', () => {
        const event: BuildStreamEvent = {
          type: 'log',
          id: 'custom-id-123',
          message: 'Test',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
        };
        const result = toTimelineItem(event);
        expect(result.id).toBe('custom-id-123');
      });

      it('generates ID from timestamp when not provided', () => {
        const event: BuildStreamEvent = {
          type: 'log',
          message: 'Test',
          projectId: 'proj-1',
          timestamp: '2024-01-01T00:00:00Z',
        };
        const result = toTimelineItem(event);
        expect(result.id).toMatch(/^tl-\d+-2024-01-01T00:00:00Z$/);
      });
    });
  });

  describe('agentEventToTimelineItem', () => {
    it('converts thinking event', () => {
      const event: ChatStreamEvent & { timestamp?: string } = {
        type: 'thinking',
        timestamp: '2024-01-01T00:00:00Z',
      };
      const result = agentEventToTimelineItem(event);
      expect(result?.type).toBe('agent_thinking');
      expect(result?.title).toBe('Agent is analyzing...');
    });

    it('converts tool_call event', () => {
      const event: ChatStreamEvent & { timestamp?: string } = {
        type: 'tool_call',
        toolName: 'deploy_app',
        arguments: { env: 'production', timeout: 3600 },
        timestamp: '2024-01-01T00:00:00Z',
      };
      const result = agentEventToTimelineItem(event);
      expect(result?.type).toBe('agent_tool_call');
      expect(result?.title).toBe('Calling deploy_app');
      expect(result?.toolName).toBe('deploy_app');
    });

    it('converts message event', () => {
      const event: ChatStreamEvent & { timestamp?: string } = {
        type: 'message',
        content: 'Deployment started successfully',
        timestamp: '2024-01-01T00:00:00Z',
      };
      const result = agentEventToTimelineItem(event);
      expect(result?.type).toBe('agent_message');
      expect(result?.title).toBe('Deployment started successfully');
    });

    it('converts tool_result event with success', () => {
      const event: ChatStreamEvent & { timestamp?: string } = {
        type: 'tool_result',
        toolName: 'deploy_app',
        success: true,
        result: { url: 'http://app.example.com' },
        timestamp: '2024-01-01T00:00:00Z',
      };
      const result = agentEventToTimelineItem(event);
      expect(result?.type).toBe('agent_tool_result');
      expect(result?.title).toBe('deploy_app completed');
      expect(result?.toolSuccess).toBe(true);
    });

    it('converts tool_result event with error', () => {
      const event: ChatStreamEvent & { timestamp?: string } = {
        type: 'tool_result',
        toolName: 'deploy_app',
        success: false,
        error: 'Insufficient resources',
        timestamp: '2024-01-01T00:00:00Z',
      };
      const result = agentEventToTimelineItem(event);
      expect(result?.title).toBe('deploy_app failed: Insufficient resources');
      expect(result?.toolSuccess).toBe(false);
      expect(result?.toolError).toBe('Insufficient resources');
    });

    it('converts tool_result event with missing error', () => {
      const event: ChatStreamEvent & { timestamp?: string } = {
        type: 'tool_result',
        toolName: 'deploy_app',
        success: false,
        timestamp: '2024-01-01T00:00:00Z',
      };
      const result = agentEventToTimelineItem(event);
      expect(result?.title).toBe('deploy_app failed: unknown error');
    });

    it('converts error event', () => {
      const event: ChatStreamEvent & { timestamp?: string } = {
        type: 'error',
        error: 'API rate limit exceeded',
        timestamp: '2024-01-01T00:00:00Z',
      };
      const result = agentEventToTimelineItem(event);
      expect(result?.type).toBe('error');
      expect(result?.title).toBe('API rate limit exceeded');
    });

    it('returns null for unknown event type', () => {
      const event: ChatStreamEvent & { timestamp?: string } = {
        type: 'unknown' as never,
        timestamp: '2024-01-01T00:00:00Z',
      };
      const result = agentEventToTimelineItem(event);
      expect(result).toBeNull();
    });

    it('generates timestamp when not provided', () => {
      const event: ChatStreamEvent & { timestamp?: string } = {
        type: 'thinking',
      };
      const result = agentEventToTimelineItem(event);
      expect(result?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('sanitizeToolArguments', () => {
    it('masks env_vars object values', () => {
      const args = {
        env_vars: {
          DATABASE_URL: 'postgres://user:pass@localhost/db',
          API_KEY: 'sk-12345',
          DEBUG: 'true',
        },
        other: 'value',
      };
      const result = sanitizeToolArguments(args);
      expect(result.env_vars).toEqual({
        DATABASE_URL: '***',
        API_KEY: '***',
        DEBUG: '***',
      });
      expect(result.other).toBe('value');
    });

    it('masks envVars (camelCase) object values', () => {
      const args = {
        envVars: {
          SECRET: 'my-secret',
        },
      };
      const result = sanitizeToolArguments(args);
      expect(result.envVars).toEqual({ SECRET: '***' });
    });

    it('masks environment_variables object values', () => {
      const args = {
        environment_variables: {
          STRIPE_KEY: 'sk_test_abc',
        },
      };
      const result = sanitizeToolArguments(args);
      expect(result.environment_variables).toEqual({ STRIPE_KEY: '***' });
    });

    it('redacts ssh_key_path', () => {
      const args = { ssh_key_path: '/home/user/.ssh/id_rsa' };
      const result = sanitizeToolArguments(args);
      expect(result.ssh_key_path).toBe('[redacted]');
    });

    it('redacts sshKeyPath', () => {
      const args = { sshKeyPath: '/home/user/.ssh/id_rsa' };
      const result = sanitizeToolArguments(args);
      expect(result.sshKeyPath).toBe('[redacted]');
    });

    it('redacts ssh_key', () => {
      const args = { ssh_key: 'BEGIN RSA PRIVATE KEY...' };
      const result = sanitizeToolArguments(args);
      expect(result.ssh_key).toBe('[redacted]');
    });

    it('redacts private_key', () => {
      const args = { private_key: 'BEGIN PRIVATE KEY...' };
      const result = sanitizeToolArguments(args);
      expect(result.private_key).toBe('[redacted]');
    });

    it('redacts token', () => {
      const args = { token: 'ghp_abc123xyz' };
      const result = sanitizeToolArguments(args);
      expect(result.token).toBe('[redacted]');
    });

    it('redacts api_key', () => {
      const args = { api_key: 'sk-proj-abc123' };
      const result = sanitizeToolArguments(args);
      expect(result.api_key).toBe('[redacted]');
    });

    it('redacts apiKey', () => {
      const args = { apiKey: 'sk-proj-abc123' };
      const result = sanitizeToolArguments(args);
      expect(result.apiKey).toBe('[redacted]');
    });

    it('redacts password', () => {
      const args = { password: 'super-secret-password' };
      const result = sanitizeToolArguments(args);
      expect(result.password).toBe('[redacted]');
    });

    it('redacts secret', () => {
      const args = { secret: 'my-secret-value' };
      const result = sanitizeToolArguments(args);
      expect(result.secret).toBe('[redacted]');
    });

    it('preserves non-secret arguments', () => {
      const args = {
        image: 'myapp:latest',
        port: 3000,
        replicas: 2,
        labels: { app: 'myapp', env: 'prod' },
      };
      const result = sanitizeToolArguments(args);
      expect(result).toEqual(args);
    });

    it('handles mixed secret and non-secret arguments', () => {
      const args = {
        image: 'myapp:latest',
        api_key: 'sk-12345',
        port: 3000,
        password: 'secret123',
        replicas: 2,
      };
      const result = sanitizeToolArguments(args);
      expect(result).toEqual({
        image: 'myapp:latest',
        api_key: '[redacted]',
        port: 3000,
        password: '[redacted]',
        replicas: 2,
      });
    });

    it('handles empty arguments object', () => {
      const result = sanitizeToolArguments({});
      expect(result).toEqual({});
    });

    it('handles env_vars with non-object value (should not mask)', () => {
      const args = {
        env_vars: 'not-an-object',
      };
      const result = sanitizeToolArguments(args);
      expect(result.env_vars).toBe('not-an-object');
    });

    it('handles env_vars with null value', () => {
      const args = {
        env_vars: null,
      };
      const result = sanitizeToolArguments(args);
      expect(result.env_vars).toBeNull();
    });
  });
});
