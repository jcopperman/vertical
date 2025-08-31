/**
 * Result formatter - Handles formatting results in different output formats
 */

import { createLogger } from '../utils/logger';
import { ProcessedResult, ConsoleOutputOptions } from './types';

export class ResultFormatter {
  private logger = createLogger('ResultFormatter');

  /**
   * Format result for console output with colors and formatting
   */
  formatConsole(result: ProcessedResult, options: Partial<ConsoleOutputOptions> = {}): string {
    const opts: ConsoleOutputOptions = {
      colors: true,
      verbose: false,
      showArtifacts: true,
      showMetadata: false,
      showTrends: false,
      ...options
    };

    let output = '';
    
    // Header
    output += this.formatHeader(result, opts);
    
    // Summary
    output += this.formatSummary(result, opts);
    
    // Performance metrics
    if (result.enrichedSummary.performance) {
      output += this.formatPerformance(result, opts);
    }
    
    // Coverage information
    if (result.summary.coverage) {
      output += this.formatCoverage(result, opts);
    }
    
    // Artifacts
    if (opts.showArtifacts && result.artifacts.length > 0) {
      output += this.formatArtifacts(result, opts);
    }
    
    // Metadata
    if (opts.showMetadata) {
      output += this.formatMetadata(result, opts);
    }
    
    // Footer with next steps
    output += this.formatFooter(result, opts);
    
    return output;
  }

  /**
   * Format result as JSON
   */
  formatJson(result: ProcessedResult): string {
    return JSON.stringify(result, null, 2);
  }

  /**
   * Format result as HTML report
   */
  formatHtml(result: ProcessedResult): string {
    const status = result.status;
    const statusColor = this.getStatusColor(status, false);
    const passRate = result.enrichedSummary.passRate;
    
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Test Report - ${result.suite} (${result.runId})</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .status { font-weight: bold; color: ${statusColor}; }
        .summary { margin: 20px 0; }
        .metric { display: inline-block; margin: 10px 20px 10px 0; }
        .metric-label { font-weight: bold; }
        .artifacts { margin: 20px 0; }
        .artifact { margin: 5px 0; }
        .footer { margin-top: 30px; padding: 20px; background: #f9f9f9; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Test Report</h1>
        <p><strong>Suite:</strong> ${result.suite}</p>
        <p><strong>Run ID:</strong> ${result.runId}</p>
        <p><strong>Status:</strong> <span class="status">${status.toUpperCase()}</span></p>
        <p><strong>Duration:</strong> ${Math.round(result.duration / 1000)}s</p>
        <p><strong>Started:</strong> ${result.startTime.toISOString()}</p>
    </div>
    
    <div class="summary">
        <h2>Summary</h2>
        <div class="metric">
            <span class="metric-label">Total:</span> ${result.summary.total}
        </div>
        <div class="metric">
            <span class="metric-label">Passed:</span> ${result.summary.passed} (${passRate.toFixed(1)}%)
        </div>
        <div class="metric">
            <span class="metric-label">Failed:</span> ${result.summary.failed}
        </div>
        <div class="metric">
            <span class="metric-label">Skipped:</span> ${result.summary.skipped}
        </div>
        ${result.summary.errors > 0 ? `
        <div class="metric">
            <span class="metric-label">Errors:</span> ${result.summary.errors}
        </div>` : ''}
    </div>
    
    ${result.artifacts.length > 0 ? `
    <div class="artifacts">
        <h2>Artifacts</h2>
        ${result.artifacts.map(artifact => `
        <div class="artifact">${artifact}</div>
        `).join('')}
    </div>` : ''}
    
    <div class="footer">
        <h3>Next Steps</h3>
        <ul>
            <li>View detailed results: <code>otp report open --run-id ${result.runId}</code></li>
            <li>Check service logs: <code>otp logs &lt;service&gt;</code></li>
            ${result.status !== 'passed' ? '<li>Debug failed tests: Check artifacts and logs above</li>' : ''}
        </ul>
    </div>
</body>
</html>`;
  }

  /**
   * Format result as JUnit XML
   */
  formatJunit(result: ProcessedResult): string {
    const duration = result.duration / 1000; // Convert to seconds
    const timestamp = result.startTime.toISOString();
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="${result.suite}" tests="${result.summary.total}" failures="${result.summary.failed}" errors="${result.summary.errors}" time="${duration}" timestamp="${timestamp}">
  <testsuite name="${result.suite}" tests="${result.summary.total}" failures="${result.summary.failed}" errors="${result.summary.errors}" time="${duration}" timestamp="${timestamp}">
    <properties>
      <property name="runId" value="${result.runId}"/>
      <property name="environment" value="${result.metadata.environment}"/>
      <property name="profile" value="${result.metadata.profile}"/>
      ${result.metadata.branch ? `<property name="branch" value="${result.metadata.branch}"/>` : ''}
      ${result.metadata.commit ? `<property name="commit" value="${result.metadata.commit}"/>` : ''}
    </properties>
    <!-- Individual test cases would be added here by specific runners -->
    <system-out><![CDATA[
Suite: ${result.suite}
Status: ${result.status}
Duration: ${duration}s
Pass Rate: ${result.enrichedSummary.passRate}%
    ]]></system-out>
  </testsuite>
</testsuites>`;
  }

  /**
   * Format result as Markdown
   */
  formatMarkdown(result: ProcessedResult): string {
    const statusEmoji = this.getStatusEmoji(result.status);
    const passRate = result.enrichedSummary.passRate;
    
    let markdown = `# Test Report ${statusEmoji}\n\n`;
    
    markdown += `## Overview\n\n`;
    markdown += `- **Suite:** ${result.suite}\n`;
    markdown += `- **Run ID:** \`${result.runId}\`\n`;
    markdown += `- **Status:** ${result.status.toUpperCase()}\n`;
    markdown += `- **Duration:** ${Math.round(result.duration / 1000)}s\n`;
    markdown += `- **Started:** ${result.startTime.toISOString()}\n\n`;
    
    markdown += `## Summary\n\n`;
    markdown += `| Metric | Count | Percentage |\n`;
    markdown += `|--------|-------|------------|\n`;
    markdown += `| Total | ${result.summary.total} | 100% |\n`;
    markdown += `| Passed | ${result.summary.passed} | ${passRate.toFixed(1)}% |\n`;
    markdown += `| Failed | ${result.summary.failed} | ${result.enrichedSummary.failureRate.toFixed(1)}% |\n`;
    markdown += `| Skipped | ${result.summary.skipped} | ${((result.summary.skipped / result.summary.total) * 100).toFixed(1)}% |\n`;
    
    if (result.summary.errors > 0) {
      markdown += `| Errors | ${result.summary.errors} | ${((result.summary.errors / result.summary.total) * 100).toFixed(1)}% |\n`;
    }
    
    markdown += `\n`;
    
    if (result.enrichedSummary.performance) {
      markdown += `## Performance\n\n`;
      markdown += `- **Average Test Duration:** ${result.enrichedSummary.performance.averageTestDuration}ms\n`;
      markdown += `- **Throughput:** ${result.enrichedSummary.performance.throughput} tests/second\n\n`;
    }
    
    if (result.summary.coverage) {
      markdown += `## Coverage\n\n`;
      markdown += `- **Lines:** ${result.summary.coverage.lines}%\n`;
      markdown += `- **Functions:** ${result.summary.coverage.functions}%\n`;
      markdown += `- **Branches:** ${result.summary.coverage.branches}%\n`;
      markdown += `- **Statements:** ${result.summary.coverage.statements}%\n\n`;
    }
    
    if (result.artifacts.length > 0) {
      markdown += `## Artifacts\n\n`;
      result.artifacts.forEach(artifact => {
        markdown += `- \`${artifact}\`\n`;
      });
      markdown += `\n`;
    }
    
    markdown += `## Next Steps\n\n`;
    markdown += `- View detailed results: \`otp report open --run-id ${result.runId}\`\n`;
    markdown += `- Check service logs: \`otp logs <service>\`\n`;
    
    if (result.status !== 'passed') {
      markdown += `- Debug failed tests: Check artifacts and logs above\n`;
    }
    
    return markdown;
  }

  private formatHeader(result: ProcessedResult, options: ConsoleOutputOptions): string {
    const statusEmoji = this.getStatusEmoji(result.status);
    const duration = Math.round(result.duration / 1000);
    
    let header = `\n${statusEmoji} Test Results (Run ID: ${result.runId}):\n`;
    header += `   Suite: ${result.suite}\n`;
    header += `   Status: ${this.colorize(result.status.toUpperCase(), this.getStatusColor(result.status, options.colors), options.colors)}\n`;
    header += `   Duration: ${duration}s\n`;
    
    return header;
  }

  private formatSummary(result: ProcessedResult, options: ConsoleOutputOptions): string {
    const { enrichedSummary } = result;
    
    let summary = `\n📈 Summary:\n`;
    summary += `   Total: ${enrichedSummary.total}\n`;
    summary += `   Passed: ${enrichedSummary.passed} ${this.colorize('✅', 'green', options.colors)} (${enrichedSummary.passRate.toFixed(1)}%)\n`;
    summary += `   Failed: ${enrichedSummary.failed} ${this.colorize('❌', 'red', options.colors)} (${enrichedSummary.failureRate.toFixed(1)}%)\n`;
    summary += `   Skipped: ${enrichedSummary.skipped} ${this.colorize('⏭️', 'yellow', options.colors)}\n`;
    
    if (enrichedSummary.errors > 0) {
      summary += `   Errors: ${enrichedSummary.errors} ${this.colorize('💥', 'red', options.colors)}\n`;
    }
    
    return summary;
  }

  private formatPerformance(result: ProcessedResult, options: ConsoleOutputOptions): string {
    const perf = result.enrichedSummary.performance!;
    
    let performance = `\n⚡ Performance:\n`;
    performance += `   Average Test Duration: ${perf.averageTestDuration}ms\n`;
    performance += `   Throughput: ${perf.throughput} tests/second\n`;
    
    if (perf.slowestTest) {
      performance += `   Slowest Test: ${perf.slowestTest}\n`;
    }
    
    if (perf.fastestTest) {
      performance += `   Fastest Test: ${perf.fastestTest}\n`;
    }
    
    return performance;
  }

  private formatCoverage(result: ProcessedResult, options: ConsoleOutputOptions): string {
    const coverage = result.summary.coverage!;
    
    let coverageOutput = `\n📋 Coverage:\n`;
    coverageOutput += `   Lines: ${coverage.lines}%\n`;
    coverageOutput += `   Functions: ${coverage.functions}%\n`;
    coverageOutput += `   Branches: ${coverage.branches}%\n`;
    coverageOutput += `   Statements: ${coverage.statements}%\n`;
    
    return coverageOutput;
  }

  private formatArtifacts(result: ProcessedResult, options: ConsoleOutputOptions): string {
    let artifacts = `\n📁 Artifacts (${result.artifacts.length}):\n`;
    result.artifacts.forEach(artifact => {
      artifacts += `   ${artifact}\n`;
    });
    
    return artifacts;
  }

  private formatMetadata(result: ProcessedResult, options: ConsoleOutputOptions): string {
    const { metadata } = result;
    
    let metadataOutput = `\n🏷️  Metadata:\n`;
    metadataOutput += `   Environment: ${metadata.environment}\n`;
    metadataOutput += `   Profile: ${metadata.profile}\n`;
    metadataOutput += `   Platform: ${metadata.platform}\n`;
    metadataOutput += `   Node Version: ${metadata.nodeVersion}\n`;
    
    if (metadata.branch) {
      metadataOutput += `   Branch: ${metadata.branch}\n`;
    }
    
    if (metadata.commit) {
      metadataOutput += `   Commit: ${metadata.commit}\n`;
    }
    
    if (metadata.tags && metadata.tags.length > 0) {
      metadataOutput += `   Tags: ${metadata.tags.join(', ')}\n`;
    }
    
    return metadataOutput;
  }

  private formatFooter(result: ProcessedResult, options: ConsoleOutputOptions): string {
    let footer = `\n💡 Next steps:\n`;
    footer += `   View detailed results: ${this.colorize(`otp report open --run-id ${result.runId}`, 'cyan', options.colors)}\n`;
    footer += `   Check service logs: ${this.colorize('otp logs <service>', 'cyan', options.colors)}\n`;
    
    if (result.status !== 'passed') {
      footer += `   Debug failed tests: Check artifacts and logs above\n`;
    }
    
    if (result.traceId) {
      footer += `   Trace ID: ${result.traceId}\n`;
    }
    
    return footer;
  }

  private getStatusEmoji(status: string): string {
    const statusEmojis: Record<string, string> = {
      'passed': '✅',
      'failed': '❌',
      'error': '💥',
      'skipped': '⏭️'
    };
    
    return statusEmojis[status] || '❓';
  }

  private getStatusColor(status: string, useColors: boolean): string {
    if (!useColors) return '';
    
    const colors: Record<string, string> = {
      'passed': 'green',
      'failed': 'red',
      'error': 'red',
      'skipped': 'yellow'
    };
    
    return colors[status] || 'white';
  }

  private colorize(text: string, color: string, useColors: boolean): string {
    if (!useColors) return text;
    
    const colors: Record<string, string> = {
      'red': '\x1b[31m',
      'green': '\x1b[32m',
      'yellow': '\x1b[33m',
      'blue': '\x1b[34m',
      'magenta': '\x1b[35m',
      'cyan': '\x1b[36m',
      'white': '\x1b[37m',
      'reset': '\x1b[0m'
    };
    
    const colorCode = colors[color] || colors.white;
    return `${colorCode}${text}${colors.reset}`;
  }
}