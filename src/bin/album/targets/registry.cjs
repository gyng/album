const vercel = require("./vercel.cjs");

const defaultTargets = [vercel];

const resolveTarget = ({ name, targets = defaultTargets }) => {
  const target = targets.find((candidate) => candidate.name === name);

  if (!target) {
    const available = targets.map((candidate) => candidate.name).join(", ");
    throw new Error(`Unknown deploy target: ${name} (available: ${available})`);
  }

  return target;
};

module.exports = { defaultTargets, resolveTarget };
