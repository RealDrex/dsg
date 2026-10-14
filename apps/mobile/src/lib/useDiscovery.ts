import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoverJobDTO } from '@bestprice/core';
import { api, ApiError } from './api';

export type DiscoveryState =
  | { phase: 'idle' }
  | { phase: 'running'; job: DiscoverJobDTO; label: string }
  | { phase: 'done'; job: DiscoverJobDTO; label: string }
  | { phase: 'error'; code: string; label: string };

/**
 * Runs a web search job and follows its real progress (the searches being
 * run and the sites they reached) until it finishes. Starting a new search
 * or unmounting stops following the previous one.
 */
export function useDiscovery() {
  const [state, setState] = useState<DiscoveryState>({ phase: 'idle' });
  const run = useRef(0);
  useEffect(() => () => { run.current++; }, []);

  const start = useCallback(async (label: string, begin: () => Promise<DiscoverJobDTO>): Promise<DiscoverJobDTO | null> => {
    const n = ++run.current;
    setState({ phase: 'running', label, job: { jobId: null, status: 'running', queries: [], sites: [], results: [], error: null, elapsedMs: 0 } });
    try {
      let job = await begin();
      let misses = 0;
      while (job.status === 'running' && job.jobId) {
        if (n !== run.current) return null;
        setState({ phase: 'running', label, job });
        await new Promise((r) => setTimeout(r, 1200));
        if (n !== run.current) return null;
        try {
          job = await api.discoverJob(job.jobId);
          misses = 0;
        } catch (e) {
          if (++misses >= 4 || (e instanceof ApiError && e.status === 404)) throw e; // brief network blips are retried
        }
        if (job.elapsedMs > 240_000) throw new ApiError(408, 'timeout', 'timeout');
      }
      if (n !== run.current) return null;
      if (job.status === 'failed') setState({ phase: 'error', label, code: job.error?.code ?? 'discovery_failed' });
      else setState({ phase: 'done', label, job });
      return job;
    } catch (e) {
      if (n === run.current) setState({ phase: 'error', label, code: e instanceof ApiError ? e.code : 'network' });
      return null;
    }
  }, []);

  const reset = useCallback(() => { run.current++; setState({ phase: 'idle' }); }, []);
  return { state, start, reset };
}
