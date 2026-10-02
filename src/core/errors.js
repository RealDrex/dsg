// An error whose message is safe (and meant) to show to the dashboard user.
function userError(message) {
  const err = new Error(message);
  err.userFacing = true;
  return err;
}

module.exports = { userError };
