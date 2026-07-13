require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ChannelType,
    StringSelectMenuBuilder,
    AttachmentBuilder
} = require('discord.js');

const { loadConfig, saveConfig, deleteGuildConfig, cleanStaleTemp } = require('./config');
const {
    resolveChannel,
    resolveRole,
    applyPlaceholders,
    applyVerifiedRole,
    removeWelcomeMessage
} = require('./utils');
const { buildSetupWizardMessage } = require('./builders');
const { verifyName } = require('./verify');
const {
    DEFAULT_SEARCHING_MESSAGE,
    DEFAULT_VERIFIED_REPLY,
    DEFAULT_WELCOME_MESSAGE,
    SETUP_WIZARD_BUTTON,
    SETUP_WELCOME_CHANNEL_SELECT,
    SETUP_VERIFIED_ROLE_SELECT,
    SETUP_LOGS_CHANNEL_SELECT,
    SETUP_WIZARD_CONTINUE,
    SETUP_WELCOME_MESSAGE_BUTTON,
    SETUP_WELCOME_IMAGE_BUTTON,
    SETUP_VERIFIED_REPLY_BUTTON,
    SETUP_WIZARD_EDIT_SELECT,
    SETUP_CHANNEL_PLACEHOLDER_BUTTON,
    SETUP_CHANNEL_PLACEHOLDER_NAME_MODAL,
    SETUP_CHANNEL_PLACEHOLDER_SELECT,
    VERIFY_BUTTON,
    VERIFY_MODAL
} = require('./constants');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.on('error', err => console.error('Client error:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

const getGuildConfig = (cfg, gid) => {
    if (!gid) return null;
    if (!cfg[gid]) cfg[gid] = {};
    return cfg[gid];
};

const buildVerifiedReplyText = (guildCfg, userId, roleName) => {
    const template = guildCfg.verifiedReply || DEFAULT_VERIFIED_REPLY;
    return applyPlaceholders(template, {
        userId,
        roleName,
        channelPlaceholders: guildCfg.channelPlaceholders || {}
    });
};

const buildVerificationEmbed = (member, name, roleName, title) => {
    return new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle(title)
        .setDescription('A member verified their name.')
        .addFields(
            { name: 'User', value: `<@${member.id}> (${member.user.tag})`, inline: false },
            { name: 'Name', value: `**${name}**`, inline: true },
            { name: 'Role', value: roleName ? `**${roleName}**` : 'No role assigned', inline: true }
        )
        .setTimestamp();
};

const refreshSetupWizardPanel = async (guild, cfg, gid) => {
    const panel = cfg[gid].setupWizardPanel;
    if (!panel?.channelId || !panel?.messageId) return;
    const panelChannel = await guild.channels.fetch(panel.channelId).catch(() => null);
    if (!panelChannel) return;
    const panelMessage = await panelChannel.messages.fetch(panel.messageId).catch(() => null);
    if (panelMessage) await panelMessage.edit(buildSetupWizardMessage(cfg[gid])).catch(() => null);
};

client.once('ready', async () => {
    const commands = [
        new SlashCommandBuilder()
            .setName('setup-channel')
            .setDescription('Set the welcome channel where the verify prompt is posted')
            .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-role')
            .setDescription('Set the role granted upon verification')
            .addRoleOption(o => o.setName('role').setDescription('Verified role').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-channel-placeholder')
            .setDescription('Define a {name} placeholder that links to a channel, for use in your messages')
            .addStringOption(o => o.setName('name').setDescription('Placeholder name, e.g. "rules" for {rules}').setRequired(true))
            .addChannelOption(o => o.setName('channel').setDescription('Channel to link this placeholder to').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('remove-channel-placeholder')
            .setDescription('Remove a previously defined channel placeholder')
            .addStringOption(o => o.setName('name').setDescription('Placeholder name to remove').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-server-logs')
            .setDescription('Set the server logs channel')
            .addChannelOption(o => o.setName('channel').setDescription('Server logs channel').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-wizard')
            .setDescription('Create or refresh a fixed setup panel')
            .addChannelOption(o => o.setName('channel').setDescription('Channel to post the setup panel in').setRequired(false))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-welcome-message')
            .setDescription('Set the message sent when a new member joins')
            .addStringOption(o => o.setName('message').setDescription('Use {user} plus any channel placeholders you define, e.g. {rules}').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-welcome-image')
            .setDescription('Set an image to display in the welcome message embed')
            .addStringOption(o => o.setName('url').setDescription('Direct image URL (leave empty to remove)').setRequired(false))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-verified-reply')
            .setDescription('Set the private reply sent after successful verification')
            .addStringOption(o => o.setName('message').setDescription('Use {user}, {role}, plus any channel placeholders you define, e.g. {rules}').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('verify-member')
            .setDescription('Manually verify a member by name and update their role')
            .addUserOption(o => o.setName('member').setDescription('The member to verify').setRequired(true))
            .addStringOption(o => o.setName('name').setDescription('The name to verify').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
        new SlashCommandBuilder()
            .setName('reset-config')
            .setDescription('Factory reset bot configuration (clears all settings)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('status')
            .setDescription('Show config')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ];

    await client.application.commands.set(commands.map(c => c.toJSON()));
    console.log('Ready as', client.user.tag);

    const cfg = await loadConfig();
    if (cleanStaleTemp(cfg)) await saveConfig(cfg);
    setInterval(async () => {
        const c = await loadConfig();
        if (cleanStaleTemp(c)) await saveConfig(c);
    }, 1000 * 60 * 60 * 24);
});

client.on('interactionCreate', async interaction => {
    if (
        !interaction.isCommand() &&
        !interaction.isModalSubmit() &&
        !interaction.isButton() &&
        !interaction.isAnySelectMenu()
    ) return;
    if (Date.now() - interaction.createdTimestamp > 3000) return;

    const cfg = await loadConfig();
    const gid = interaction.guild?.id;
    const guildCfg = getGuildConfig(cfg, gid);

    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'setup-channel') {
            cfg[gid].welcomeChannel = interaction.options.getChannel('channel').id;
            await saveConfig(cfg);
            await refreshSetupWizardPanel(interaction.guild, cfg, gid);
            return interaction.reply({ content: 'Welcome channel set', flags: 64 });
        }

        if (interaction.commandName === 'setup-role') {
            cfg[gid].verifiedRole = interaction.options.getRole('role').id;
            await saveConfig(cfg);
            await refreshSetupWizardPanel(interaction.guild, cfg, gid);
            return interaction.reply({ content: 'Verified role set', flags: 64 });
        }

        if (interaction.commandName === 'setup-channel-placeholder') {
            const rawName = interaction.options.getString('name').trim().toLowerCase();
            const name = rawName.replace(/[^a-z0-9_-]/g, '');
            if (!name) {
                return interaction.reply({ content: '❌ Please use a name made of letters, numbers, underscores, or hyphens (e.g. "rules").', flags: 64 });
            }
            const channel = interaction.options.getChannel('channel');
            cfg[gid].channelPlaceholders ??= {};
            cfg[gid].channelPlaceholders[name] = channel.id;
            await saveConfig(cfg);
            await refreshSetupWizardPanel(interaction.guild, cfg, gid);
            return interaction.reply({ content: `✅ \`{${name}}\` now links to ${channel.toString()}.`, flags: 64 });
        }

        if (interaction.commandName === 'remove-channel-placeholder') {
            const name = interaction.options.getString('name').trim().toLowerCase();
            if (!cfg[gid].channelPlaceholders?.[name]) {
                return interaction.reply({ content: `❌ No channel placeholder named \`{${name}}\` was found.`, flags: 64 });
            }
            delete cfg[gid].channelPlaceholders[name];
            await saveConfig(cfg);
            await refreshSetupWizardPanel(interaction.guild, cfg, gid);
            return interaction.reply({ content: `✅ Removed \`{${name}}\`.`, flags: 64 });
        }

        if (interaction.commandName === 'setup-server-logs') {
            cfg[gid].serverLogsChannel = interaction.options.getChannel('channel').id;
            await saveConfig(cfg);
            await refreshSetupWizardPanel(interaction.guild, cfg, gid);
            return interaction.reply({ content: 'Server logs channel set', flags: 64 });
        }

        if (interaction.commandName === 'setup-welcome-message') {
            const message = interaction.options.getString('message');
            cfg[gid].welcomeMessage = message;
            await saveConfig(cfg);
            await refreshSetupWizardPanel(interaction.guild, cfg, gid);
            return interaction.reply({ content: `✅ Welcome message set:\n${message.replace('{user}', '@[member]')}`, flags: 64 });
        }

        if (interaction.commandName === 'setup-welcome-image') {
            const url = interaction.options.getString('url');
            if (url) {
                cfg[gid].welcomeImage = url;
            } else {
                delete cfg[gid].welcomeImage;
            }
            await saveConfig(cfg);
            await refreshSetupWizardPanel(interaction.guild, cfg, gid);
            return interaction.reply({ content: url ? '✅ Welcome image set.' : '✅ Welcome image removed.', flags: 64 });
        }

        if (interaction.commandName === 'setup-verified-reply') {
            const message = interaction.options.getString('message');
            cfg[gid].verifiedReply = message;
            await saveConfig(cfg);
            await refreshSetupWizardPanel(interaction.guild, cfg, gid);
            return interaction.reply({ content: `✅ Verified reply set:\n${message}`, flags: 64 });
        }

        if (interaction.commandName === 'setup-wizard') {
            const channel = interaction.options.getChannel('channel') || interaction.channel;
            if (!channel || !channel.isTextBased() || channel.isThread()) {
                return interaction.reply({ content: 'Please choose a text channel to post the setup panel in.', flags: 64 });
            }

            const botMember = await interaction.guild.members.fetchMe().catch(() => null);
            if (botMember) {
                const perms = channel.permissionsFor(botMember);
                if (!perms?.has(PermissionFlagsBits.SendMessages)) {
                    return interaction.reply({ content: `❌ I don't have permission to send messages in ${channel.toString()}.`, flags: 64 });
                }
            }

            const panelData = buildSetupWizardMessage(guildCfg);
            cfg[gid].setupWizardPanel ??= {};
            let panelMessage = null;

            try {
                if (cfg[gid].setupWizardPanel.channelId && cfg[gid].setupWizardPanel.messageId) {
                    const panelChannel = await interaction.guild.channels.fetch(cfg[gid].setupWizardPanel.channelId).catch(() => null);
                    if (panelChannel) panelMessage = await panelChannel.messages.fetch(cfg[gid].setupWizardPanel.messageId).catch(() => null);
                }

                if (panelMessage) {
                    await panelMessage.edit(panelData).catch(() => null);
                } else {
                    panelMessage = await channel.send(panelData);
                }

                cfg[gid].setupWizardPanel = { channelId: channel.id, messageId: panelMessage.id };
                await saveConfig(cfg);
            } catch (err) {
                console.error('Setup wizard panel error:', err.message || err);
                return interaction.reply({ content: `❌ Unable to post the setup wizard panel: ${err.message || 'Unknown error'}`, flags: 64 });
            }

            return interaction.reply({ content: `Setup wizard panel posted in ${channel.toString()}.`, flags: 64 });
        }

        if (interaction.commandName === 'verify-member') {
            const targetUser = interaction.options.getUser('member');
            const name = interaction.options.getString('name');

            await interaction.deferReply({ flags: 64 });

            if (!(await verifyName(name))) {
                return interaction.editReply({ content: `❌ Could not verify ${name}. Please check the name and try again.` });
            }

            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!member) {
                return interaction.editReply({ content: 'Could not find that member in this server.' });
            }

            const role = guildCfg.verifiedRole ? await interaction.guild.roles.fetch(guildCfg.verifiedRole).catch(() => null) : null;
            const hadRole = role ? member.roles.cache.has(role.id) : false;

            const confirmContent = [
                `**Verify member: <@${targetUser.id}>**`,
                ``,
                `**Name:** ${name}`,
                `**Role:** ${hadRole ? 'Already has role' : (role ? role.name : 'No role configured')}`,
                ``,
                `Do you want to proceed?`
            ].join('\n');

            await interaction.editReply({
                content: confirmContent,
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('verify_member_confirm').setLabel('Confirm').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('verify_member_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                    )
                ]
            });

            const reply = await interaction.fetchReply();
            const confirmation = await reply.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id && ['verify_member_confirm', 'verify_member_cancel'].includes(i.customId),
                time: 60_000
            }).catch(() => null);

            if (!confirmation || confirmation.customId === 'verify_member_cancel') {
                await interaction.editReply({ content: '❌ Cancelled.', components: [] });
                return;
            }

            await confirmation.update({ content: '⏳ Processing...', components: [] });

            try {
                await member.setNickname(rsn);
            } catch (err) {
                console.error('Nickname error:', err);
            }

            const roleName = await applyVerifiedRole(member, guildCfg);
            await removeWelcomeMessage(client, cfg, gid, guildCfg, member.id);
            await saveConfig(cfg);

            try {
                if (guildCfg.serverLogsChannel) {
                    const logChannel = await interaction.guild.channels.fetch(guildCfg.serverLogsChannel).catch(() => null);
                    if (logChannel) {
                        const embed = buildVerificationEmbed(member, name, roleName, 'Manual Verification');
                        await logChannel.send({ embeds: [embed] });
                    }
                }
            } catch (err) {
                console.error('Server logs error:', err);
            }

            return interaction.editReply({
                content: [
                    `✅ **Member verified: <@${targetUser.id}>**`,
                    ``,
                    `**Name:** ${name}`,
                    `**Role:** ${roleName ?? 'Unchanged'}`,
                ].join('\n')
            });
        }

        if (interaction.commandName === 'reset-config') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('confirm_reset_config').setLabel('Confirm Reset').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('cancel_reset_config').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            );
            return interaction.reply({ content: '⚠️ **WARNING**: This will factory reset ALL bot configuration for this guild. This cannot be undone. Are you sure?', components: [row], flags: 64 });
        }

        if (interaction.commandName === 'status') {
            const json = JSON.stringify(cfg[gid] || {}, null, 2);
            const attachment = new AttachmentBuilder(Buffer.from(json, 'utf-8'), { name: `status-${gid}.json` });
            return interaction.reply({ files: [attachment], flags: 64 });
        }
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === SETUP_WIZARD_EDIT_SELECT) {
            const field = interaction.values[0];

            if (field === 'welcomeChannel' || field === 'serverLogsChannel') {
                const labels = { welcomeChannel: 'welcome', serverLogsChannel: 'logs' };
                const row = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId(`setup_edit_channel_${field}`)
                        .setPlaceholder(`Select new ${labels[field]} channel`)
                        .setChannelTypes([ChannelType.GuildText])
                        .setMinValues(1)
                        .setMaxValues(1)
                );
                return interaction.reply({ content: 'Select the new channel:', components: [row], flags: 64 });
            }

            if (field === 'verifiedRole') {
                const row = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId(`setup_edit_role_${field}`)
                        .setPlaceholder('Select new verified role')
                        .setMinValues(1)
                        .setMaxValues(1)
                );
                return interaction.reply({ content: 'Select the new role:', components: [row], flags: 64 });
            }
        }
    }

    if (interaction.isButton()) {
        const customId = interaction.customId;

        if (customId === SETUP_WIZARD_BUTTON) {
            const isConfigured = guildCfg.welcomeChannel && guildCfg.verifiedRole;

            if (isConfigured) {
                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(SETUP_WIZARD_EDIT_SELECT)
                        .setPlaceholder('What do you want to update?')
                        .addOptions([
                            { label: 'Welcome Channel', value: 'welcomeChannel', description: 'Change the welcome channel' },
                            { label: 'Verified Role', value: 'verifiedRole', description: 'Change the verified role' },
                            { label: 'Logs Channel', value: 'serverLogsChannel', description: 'Change the logs channel' },
                        ])
                );
                return interaction.reply({ content: 'What would you like to update?', components: [row], flags: 64 });
            }

            const welcomeChannelSelect = new ChannelSelectMenuBuilder().setCustomId(SETUP_WELCOME_CHANNEL_SELECT).setPlaceholder('Select welcome text channel').setChannelTypes([ChannelType.GuildText]).setMinValues(1).setMaxValues(1);
            const verifiedRoleSelect = new RoleSelectMenuBuilder().setCustomId(SETUP_VERIFIED_ROLE_SELECT).setPlaceholder('Select verified role').setMinValues(1).setMaxValues(1);
            const logsChannelSelect = new ChannelSelectMenuBuilder().setCustomId(SETUP_LOGS_CHANNEL_SELECT).setPlaceholder('Select optional logs channel').setChannelTypes([ChannelType.GuildText]).setMinValues(0).setMaxValues(1);

            const rows = [
                new ActionRowBuilder().addComponents(welcomeChannelSelect),
                new ActionRowBuilder().addComponents(verifiedRoleSelect),
                new ActionRowBuilder().addComponents(logsChannelSelect),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(SETUP_WIZARD_CONTINUE).setLabel('Continue').setStyle(ButtonStyle.Primary)
                )
            ];

            const uid = interaction.user.id;
            cfg[gid].wizardTemp ??= {};
            cfg[gid].wizardTemp[uid] ??= {};
            await saveConfig(cfg);
            return interaction.reply({ content: 'Select the welcome channel and verified role (logs channel is optional), then click Continue. You can wire up {rules} and other channel placeholders afterward with the "Add/Update Channel Placeholder" button.', components: rows, flags: 64 });
        }

        if (customId === SETUP_WELCOME_MESSAGE_BUTTON) {
            const modal = new ModalBuilder().setCustomId('setup_welcome_message_modal').setTitle('Set Welcome Message');
            const input = new TextInputBuilder()
                .setCustomId('welcome_message')
                .setLabel('Message ({user}, {rules}, etc.)')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setValue(guildCfg.welcomeMessage || '');
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }

        if (customId === SETUP_VERIFIED_REPLY_BUTTON) {
            const modal = new ModalBuilder().setCustomId('setup_verified_reply_modal').setTitle('Set Verified Reply');
            const input = new TextInputBuilder()
                .setCustomId('verified_reply')
                .setLabel('Available: {user} {role} {rules}')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setValue(guildCfg.verifiedReply || '');
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }

        if (customId === SETUP_CHANNEL_PLACEHOLDER_BUTTON) {
            const modal = new ModalBuilder().setCustomId(SETUP_CHANNEL_PLACEHOLDER_NAME_MODAL).setTitle('Channel Placeholder Name');
            const input = new TextInputBuilder()
                .setCustomId('placeholder_name')
                .setLabel('Name (e.g. "rules" for {rules})')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('rules');
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }

        if (customId === SETUP_WELCOME_IMAGE_BUTTON) {
            const modal = new ModalBuilder().setCustomId('setup_welcome_image_modal').setTitle('Set Welcome Image');
            const input = new TextInputBuilder()
                .setCustomId('welcome_image_url')
                .setLabel('Direct image URL (leave blank to remove)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setValue(guildCfg.welcomeImage || '');
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }

        if (customId === SETUP_WIZARD_CONTINUE) {
            const uid = interaction.user.id;
            const stored = cfg[gid].wizardTemp?.[uid] || {};
            if (!stored.welcomeChannel || !stored.verifiedRole) {
                return interaction.reply({ content: 'Please select the welcome channel and verified role before continuing.', flags: 64 });
            }

            const welcomeChannel = await resolveChannel(interaction.guild, `<#${stored.welcomeChannel}>`);
            const verifiedRole = await resolveRole(interaction.guild, `<@&${stored.verifiedRole}>`);
            const logsChannel = stored.logsChannel ? await resolveChannel(interaction.guild, `<#${stored.logsChannel}>`) : null;

            if (!welcomeChannel || welcomeChannel.type !== ChannelType.GuildText) {
                return interaction.reply({ content: 'Please select a valid welcome text channel before continuing.', flags: 64 });
            }
            if (!verifiedRole) {
                return interaction.reply({ content: 'Please select a valid verified role before continuing.', flags: 64 });
            }

            cfg[gid].welcomeChannel = welcomeChannel.id;
            cfg[gid].verifiedRole = verifiedRole.id;
            if (logsChannel) cfg[gid].serverLogsChannel = logsChannel.id;
            delete cfg[gid].wizardTemp?.[uid];
            await saveConfig(cfg);

            await refreshSetupWizardPanel(interaction.guild, cfg, gid);

            return interaction.reply({
                content: [
                    `✅ Setup complete!`,
                    `• Welcome channel: ${welcomeChannel.toString()}`,
                    `• Verified role: ${verifiedRole.toString()}`,
                    logsChannel ? `• Logs channel: ${logsChannel.toString()}` : null,
                    `Use "Add/Update Channel Placeholder" on the panel to wire up {rules} and any other channel references.`,
                ].filter(Boolean).join('\n'),
                flags: 64
            });
        }

        if (customId === VERIFY_BUTTON) {
            const messageId = interaction.message?.id;
            const welcomeEntries = guildCfg?.welcomeMessages || {};
            const targetEntry = Object.entries(welcomeEntries).find(([, value]) => value.messageId === messageId);
            if (targetEntry && targetEntry[0] !== interaction.user.id) {
                return interaction.reply({ content: 'This button is only for the user it was posted for. If you need access, please ask an admin.', flags: 64 });
            }
            const modal = new ModalBuilder().setCustomId(VERIFY_MODAL).setTitle('Verify Your Name');
            const input = new TextInputBuilder().setCustomId('name').setLabel('Your name').setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }

        if (customId === 'confirm_reset_config') {
            await deleteGuildConfig(gid);
            return interaction.reply({ content: '✅ Bot configuration has been factory reset for this guild. All settings have been cleared.', flags: 64 });
        }

        if (customId === 'cancel_reset_config') {
            return interaction.reply({ content: '❌ Reset cancelled.', flags: 64 });
        }
    }

    if (interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
        const uid = interaction.user.id;
        cfg[gid].wizardTemp ??= {};
        cfg[gid].wizardTemp[uid] ??= {};

        if (interaction.customId === SETUP_WELCOME_CHANNEL_SELECT) {
            cfg[gid].wizardTemp[uid].welcomeChannel = interaction.values[0];
            cfg[gid].wizardTemp[uid].timestamp = Date.now();
        }

        if (interaction.customId === SETUP_VERIFIED_ROLE_SELECT) {
            cfg[gid].wizardTemp[uid].verifiedRole = interaction.values[0];
            cfg[gid].wizardTemp[uid].timestamp = Date.now();
        }

        if (interaction.customId === SETUP_LOGS_CHANNEL_SELECT) {
            cfg[gid].wizardTemp[uid].logsChannel = interaction.values[0] || null;
            cfg[gid].wizardTemp[uid].timestamp = Date.now();
        }

        if (interaction.customId === SETUP_CHANNEL_PLACEHOLDER_SELECT) {
            const pendingName = cfg[gid].wizardTemp?.[uid]?.pendingPlaceholderName;
            if (!pendingName) {
                return interaction.update({ content: '❌ Something went wrong — please click "Add/Update Channel Placeholder" again.', components: [] });
            }
            cfg[gid].channelPlaceholders ??= {};
            cfg[gid].channelPlaceholders[pendingName] = interaction.values[0];
            delete cfg[gid].wizardTemp[uid].pendingPlaceholderName;
            await saveConfig(cfg);
            await refreshSetupWizardPanel(interaction.guild, cfg, gid);
            return interaction.update({ content: `✅ \`{${pendingName}}\` now links to <#${interaction.values[0]}>.`, components: [] });
        }

        // Handle the "edit an existing field" selects (setup_edit_channel_*, setup_edit_role_*)
        if (interaction.customId.startsWith('setup_edit_channel_')) {
            const field = interaction.customId.replace('setup_edit_channel_', '');
            cfg[gid][field] = interaction.values[0];
            await saveConfig(cfg);
            await refreshSetupWizardPanel(interaction.guild, cfg, gid);
            return interaction.update({ content: '✅ Updated successfully.', components: [] });
        }

        if (interaction.customId.startsWith('setup_edit_role_')) {
            const field = interaction.customId.replace('setup_edit_role_', '');
            cfg[gid][field] = interaction.values[0];
            await saveConfig(cfg);
            await refreshSetupWizardPanel(interaction.guild, cfg, gid);
            return interaction.update({ content: '✅ Updated successfully.', components: [] });
        }

        await saveConfig(cfg);
        return interaction.update({ components: interaction.message.components, flags: 64 });
    }

    if (interaction.isModalSubmit() && interaction.customId === VERIFY_MODAL) {
        const name = interaction.fields.getTextInputValue('name');

        await interaction.reply({ content: DEFAULT_SEARCHING_MESSAGE, flags: 64 });

        if (!(await verifyName(name))) {
            return interaction.editReply({ content: `❌ Sorry, I couldn't verify ${name}. Please double-check the name and try again.` });
        }

        let member = null;
        try {
            member = await interaction.guild.members.fetch(interaction.user.id);
            await member.setNickname(rsn);
        } catch (err) {
            console.error('Member fetch error:', err);
        }

        if (!member) {
            return interaction.editReply({ content: '❌ Something went wrong finding your member record. Please try again or contact an admin.' });
        }

        const roleName = await applyVerifiedRole(member, guildCfg);

        try {
            await removeWelcomeMessage(client, cfg, gid, guildCfg, interaction.user.id);
            await saveConfig(cfg);
        } catch (err) {
            console.error('Delete welcome error:', err);
        }

        try {
            if (guildCfg.serverLogsChannel) {
                const logChannel = await interaction.guild.channels.fetch(guildCfg.serverLogsChannel).catch(() => null);
                if (logChannel) {
                    const embed = buildVerificationEmbed(member, name, roleName, 'Verification Log');
                    await logChannel.send({ embeds: [embed] });
                }
            }
        } catch (err) {
            console.error('Server logs error:', err);
        }

        return interaction.editReply({
            content: buildVerifiedReplyText(guildCfg, interaction.user.id, roleName)
        });
    }

    if (interaction.isModalSubmit() && interaction.customId === SETUP_CHANNEL_PLACEHOLDER_NAME_MODAL) {
        const rawName = interaction.fields.getTextInputValue('placeholder_name').trim().toLowerCase();
        const name = rawName.replace(/[^a-z0-9_-]/g, '');
        if (!name) {
            return interaction.reply({ content: '❌ Please use a name made of letters, numbers, underscores, or hyphens (e.g. "rules").', flags: 64 });
        }

        const uid = interaction.user.id;
        cfg[gid].wizardTemp ??= {};
        cfg[gid].wizardTemp[uid] ??= {};
        cfg[gid].wizardTemp[uid].pendingPlaceholderName = name;
        cfg[gid].wizardTemp[uid].timestamp = Date.now();
        await saveConfig(cfg);

        const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId(SETUP_CHANNEL_PLACEHOLDER_SELECT)
                .setPlaceholder(`Select channel for {${name}}`)
                .setChannelTypes([ChannelType.GuildText])
                .setMinValues(1)
                .setMaxValues(1)
        );
        return interaction.reply({ content: `Select the channel that \`{${name}}\` should link to:`, components: [row], flags: 64 });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'setup_welcome_message_modal') {
        const message = interaction.fields.getTextInputValue('welcome_message').trim();
        if (message) cfg[gid].welcomeMessage = message; else delete cfg[gid].welcomeMessage;
        await saveConfig(cfg);
        await refreshSetupWizardPanel(interaction.guild, cfg, gid);
        return interaction.reply({ content: message ? `✅ Welcome message updated:\n${message.replace('{user}', '@[member]')}` : '✅ Welcome message reset to default.', flags: 64 });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'setup_verified_reply_modal') {
        const reply = interaction.fields.getTextInputValue('verified_reply').trim();
        if (reply) cfg[gid].verifiedReply = reply; else delete cfg[gid].verifiedReply;
        await saveConfig(cfg);
        await refreshSetupWizardPanel(interaction.guild, cfg, gid);
        return interaction.reply({ content: reply ? `✅ Verified reply updated:\n${reply}` : '✅ Verified reply reset to default.', flags: 64 });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'setup_welcome_image_modal') {
        const url = interaction.fields.getTextInputValue('welcome_image_url').trim();
        if (url) cfg[gid].welcomeImage = url; else delete cfg[gid].welcomeImage;
        await saveConfig(cfg);
        await refreshSetupWizardPanel(interaction.guild, cfg, gid);
        return interaction.reply({ content: url ? '✅ Welcome image updated.' : '✅ Welcome image removed.', flags: 64 });
    }
});

const recentJoins = new Set();

client.on('guildMemberAdd', async member => {
    const key = `${member.guild.id}-${member.id}`;
    if (recentJoins.has(key)) return;
    recentJoins.add(key);
    setTimeout(() => recentJoins.delete(key), 5000);

    await new Promise(resolve => setTimeout(resolve, 3000));

    const cfg = await loadConfig();
    const guildCfg = cfg[member.guild.id];

    if (!guildCfg?.welcomeChannel) return;

    const ch = member.guild.channels.cache.get(guildCfg.welcomeChannel);
    if (!ch) return;

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(VERIFY_BUTTON)
            .setLabel('Verify')
            .setStyle(ButtonStyle.Primary)
    );

    let roleName = null;
    if (guildCfg.verifiedRole) {
        const role = member.guild.roles.cache.get(guildCfg.verifiedRole);
        roleName = role?.name || null;
    }

    const welcomeText = applyPlaceholders(guildCfg.welcomeMessage || DEFAULT_WELCOME_MESSAGE, {
        userId: member.id,
        roleName,
        channelPlaceholders: guildCfg.channelPlaceholders || {}
    });

    const messagePayload = { content: welcomeText, components: [row] };

    if (guildCfg.welcomeImage) {
        messagePayload.embeds = [{ image: { url: guildCfg.welcomeImage } }];
    }

    const msg = await ch.send(messagePayload);

    cfg[member.guild.id].welcomeMessages ??= {};
    cfg[member.guild.id].welcomeMessages[member.id] = {
        channelId: ch.id,
        messageId: msg.id
    };

    await saveConfig(cfg);
});

client.login(process.env.DISCORD_TOKEN).catch(err => console.error('Login failed:', err));