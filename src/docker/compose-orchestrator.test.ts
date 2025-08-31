/**
 * Tests for Docker Compose orchestrator
 */

import { DockerComposeOrchestrator, ComposeConfig } from './compose-orchestrator';

describe('DockerComposeOrchestrator', () => {
  const mockConfig: ComposeConfig = {
    projectName: 'otp-test',
    baseComposeFile: 'docker-compose.yml',
    workingDirectory: '/test/project'
  };

  describe('constructor', () => {
    it('should create an instance', () => {
      const orchestrator = new DockerComposeOrchestrator(mockConfig);
      expect(orchestrator).toBeDefined();
    });
  });
});