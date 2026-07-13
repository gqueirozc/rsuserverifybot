const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require('discord.js');
const {
    SETUP_WIZARD_BUTTON,
    SETUP_WELCOME_MESSAGE_BUTTON,
    SETUP_WELCOME_IMAGE_BUTTON,
    SETUP_VERIFIED_REPLY_BUTTON,
    SETUP_CHANNEL_PLACEHOLDER_BUTTON
} = require('./constants');

const buildSetupWizardMessage = (guildCfg = {}) => {
    const isConfigured = !!(guildCfg.welcomeChannel && guildCfg.verifiedRole);

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(SETUP_WIZARD_BUTTON)
            .setLabel(isConfigured ? 'Update Setup' : 'Start Setup Wizard')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(SETUP_WELCOME_MESSAGE_BUTTON)
            .setLabel(guildCfg.welcomeMessage ? 'Update Welcome Message' : 'Set Welcome Message')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(SETUP_WELCOME_IMAGE_BUTTON)
            .setLabel(guildCfg.welcomeImage ? 'Update Welcome Image' : 'Set Welcome Image')
            .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(SETUP_VERIFIED_REPLY_BUTTON)
            .setLabel(guildCfg.verifiedReply ? 'Update Verified Reply' : 'Set Verified Reply')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(SETUP_CHANNEL_PLACEHOLDER_BUTTON)
            .setLabel('Add/Update Channel Placeholder')
            .setStyle(ButtonStyle.Secondary)
    );

    const placeholderEntries = Object.entries(guildCfg.channelPlaceholders || {});
    const placeholderText = placeholderEntries.length
        ? placeholderEntries.map(([name, id]) => `\`{${name}}\` → <#${id}>`).join('\n')
        : '*None set — add one with the button below.*';

    const embed = new EmbedBuilder()
        .setTitle('Verification Bot Setup')
        .setColor(0x00B0F4);

    if (isConfigured) {
        embed
            .setDescription(
                'Verification is configured. Use the buttons below to update any setting.\n' +
                'Tip: use `{user}`, `{role}`, and any of your custom channel placeholders (below) in your welcome message and verified reply.'
            )
            .addFields(
                { name: '📨 Welcome Channel', value: `<#${guildCfg.welcomeChannel}>`, inline: true },
                { name: '🏷️ Verified Role', value: `<@&${guildCfg.verifiedRole}>`, inline: true },
                { name: '📋 Logs Channel', value: guildCfg.serverLogsChannel ? `<#${guildCfg.serverLogsChannel}>` : '*Not set*', inline: true },
                { name: '💬 Welcome Message', value: guildCfg.welcomeMessage || '*Not set — using default*', inline: false },
                { name: '🖼️ Welcome Image (optional)', value: guildCfg.welcomeImage ? '✅ Set' : '*Not set*', inline: true },
                { name: '✅ Verified Reply', value: guildCfg.verifiedReply || '*Not set — using default*', inline: false },
                { name: '🔗 Channel Placeholders', value: placeholderText, inline: false },
            );
    } else {
        embed
            .setDescription('Click the button below to configure verification for this server. This wizard saves the welcome channel, verified role, and an optional logs channel.')
            .addFields(
                { name: 'Step 1', value: 'Click the button to select the welcome channel and verified role.', inline: false },
                { name: 'Step 2', value: 'Optionally pick a logs channel too.', inline: false },
                { name: 'Step 3', value: 'Click Continue to save your settings, then use "Add/Update Channel Placeholder" to wire up things like {rules}.', inline: false }
            );
    }

    return { embeds: [embed], components: [row1, row2] };
};

module.exports = { buildSetupWizardMessage };
