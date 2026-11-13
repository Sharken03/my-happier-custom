import { logger } from '@/ui/logger';

/**
 * Writes one info line to the log file with the seconds since the process started. A prewarmed runner counts
 * from its own start, so compare steps by their difference, not by the first value.
 */
export function logStartupStep(label: string): void {
  logger.infoFile(`[startup-timing] ${label} at ${process.uptime().toFixed(2)} s`);
}
