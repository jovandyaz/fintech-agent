import { z } from 'zod';

// Zod probes `new Function` once to compile faster parsers; the 02 G7 CSP has
// no 'unsafe-eval', so the probe would be refused and reported on every load.
z.config({ jitless: true });
