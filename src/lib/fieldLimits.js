// Maximum lengths for user-entered text, in one place. The API routes
// validate against these (see lib/validation.js) and the Mongoose schemas
// enforce the same numbers as a second line of defense (see
// lib/schemaLimits.js), so the two can't drift apart. Plain constants with
// no imports, so client components can import them too.

export const MAX_TEAM_NAME_LENGTH = 100;
export const MAX_USER_NAME_LENGTH = 100; // matches User.name's maxlength and registration
export const MAX_PROJECT_NAME_LENGTH = 150;
export const MAX_PROJECT_DESCRIPTION_LENGTH = 2000;
export const MAX_COLUMN_NAME_LENGTH = 60;
export const MAX_TASK_TITLE_LENGTH = 200;
export const MAX_TASK_DESCRIPTION_LENGTH = 5000;
