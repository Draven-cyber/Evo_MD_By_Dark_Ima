const commands = new Map();

function cmd(options, execute) {
    commands.set(options.pattern, {
        ...options,
        execute
    });
}

function getCommands() {
    return commands;
}

module.exports = { cmd, getCommands };
