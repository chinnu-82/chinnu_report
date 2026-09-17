'use strict';

// Shared between the worker-side fixtures and the reporter (which must not import @playwright/test's `test`).
module.exports = {
  STORY_ATTACHMENT: 'aurora-story',
  DIAGNOSTICS_ATTACHMENT: 'aurora-diagnostics',
};
