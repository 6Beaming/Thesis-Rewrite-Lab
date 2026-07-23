import { lookupAcademicSourcesViaMcp } from '../server/mcp/academicSources.js';

const doi = process.argv[2] || '10.1038/nphys1170';
const result = await lookupAcademicSourcesViaMcp(`DOI: ${doi}`);

console.log(JSON.stringify(result, null, 2));
if (result.status !== 'completed') process.exitCode = 1;
