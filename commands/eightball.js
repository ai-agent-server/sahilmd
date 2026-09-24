module.exports = {
    pattern: "8ball",
    desc: "Magic 8-Ball gives answers",
    category: "fun",
    use: ".8ball [your yes/no question]",
    react: "🎱",
    filename: __filename,
    execute: async (conn, mek, m, { from, q, reply }) => {
        if (!q) return reply("Ask a yes/no question! Example: .8ball Will I be rich?");
        
        let responses = [
            "Yes!", "No.", "Maybe...", "Definitely!", "Not sure.", 
            "Ask again later.", "I don't think so.", "Absolutely!", 
            "No way!", "Looks promising!"
        ];
        
        let answer = responses[Math.floor(Math.random() * responses.length)];
        
        // Send simple reply
        await reply(`🎱 *Magic 8-Ball says:* ${answer}`);
    }
};