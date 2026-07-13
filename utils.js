const getGuildRole = async (guild, roleId) => {
    if (!roleId) return null;
    return guild.roles.cache.get(roleId) ||
        await guild.roles.fetch(roleId).catch(() => null);
};

const resolveChannel = async (guild, value) => {
    if (!value) return null;
    const match = value.match(/<#?(\d+)>?/);
    if (!match) return null;
    return guild.channels.cache.get(match[1]) || await guild.channels.fetch(match[1]).catch(() => null);
};

const resolveRole = async (guild, value) => {
    if (!value) return null;
    const match = value.match(/<@&?(\d+)>?/);
    if (!match) return null;
    return guild.roles.cache.get(match[1]) || await guild.roles.fetch(match[1]).catch(() => null);
};


const applyPlaceholders = (template, { userId, roleName, channelPlaceholders = {} } = {}) => {
    if (!template) return template;
    return template.replace(/{([a-zA-Z0-9_-]+)}/g, (match, rawKey) => {
        const key = rawKey.toLowerCase();
        if (key === 'user') return userId ? `<@${userId}>` : '';
        if (key === 'role') return roleName || 'the verified role';
        const channelId = channelPlaceholders[key];
        return channelId ? `<#${channelId}>` : `#${key}`;
    });
};

const applyVerifiedRole = async (member, guildCfg) => {
    const role = await getGuildRole(member.guild, guildCfg.verifiedRole);
    if (!role) return null;
    if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role).catch(() => null);
    }
    return role.name;
};

const removeWelcomeMessage = async (client, cfg, gid, guildCfg, memberId) => {
    const welcome = guildCfg?.welcomeMessages?.[memberId];
    if (!welcome) return;

    try {
        const msgChannel = await client.channels.fetch(welcome.channelId).catch(() => null);
        const msg = msgChannel ? await msgChannel.messages.fetch(welcome.messageId).catch(() => null) : null;
        if (msg) await msg.delete().catch(() => null);
    } catch (err) {
        console.error('Delete welcome error:', err);
    }

    delete guildCfg.welcomeMessages?.[memberId];
};

module.exports = {
    getGuildRole,
    resolveChannel,
    resolveRole,
    applyPlaceholders,
    applyVerifiedRole,
    removeWelcomeMessage
};
