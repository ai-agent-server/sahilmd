const path = require('path');

class DatabaseManager {
    static instance = null;
    static available = false;

    static getInstance() {
        if (DatabaseManager.instance !== null || DatabaseManager._tried) {
            return DatabaseManager.instance;
        }
        DatabaseManager._tried = true;

        const DATABASE_URL = process.env.DATABASE_URL || '';

        try {
            const Sequelize = require('sequelize');

            if (DATABASE_URL && (DATABASE_URL.startsWith('postgres') || DATABASE_URL.startsWith('postgresql'))) {
                DatabaseManager.instance = new Sequelize(DATABASE_URL, {
                    dialect: 'postgres',
                    protocol: 'postgres',
                    dialectOptions: {
                        ssl: { require: true, rejectUnauthorized: false },
                    },
                    logging: false,
                });
                DatabaseManager.available = true;
                console.log('📦 Using Postgres database');
            } else if (process.env.DYNO) {
                console.log('ℹ️ Heroku without DATABASE_URL — DB disabled (add Heroku Postgres for persistent sessions)');
                DatabaseManager.instance = null;
                DatabaseManager.available = false;
            } else {
                // Local only – try sqlite if available
                try {
                    require.resolve('sqlite3');
                    const storage = path.join(__dirname, '..', 'database.db');
                    DatabaseManager.instance = new Sequelize({
                        dialect: 'sqlite',
                        storage,
                        logging: false,
                    });
                    DatabaseManager.available = true;
                    console.log('📦 Using SQLite database:', storage);
                } catch (sqliteErr) {
                    console.log('ℹ️ SQLite not available, running without DB');
                    DatabaseManager.instance = null;
                    DatabaseManager.available = false;
                }
            }
        } catch (e) {
            console.error('⚠️ Database init failed:', e.message);
            DatabaseManager.instance = null;
            DatabaseManager.available = false;
        }

        return DatabaseManager.instance;
    }

    static isAvailable() {
        return DatabaseManager.available && !!DatabaseManager.instance;
    }
}

DatabaseManager._tried = false;
let DATABASE = null;
try {
    DATABASE = DatabaseManager.getInstance();
    if (DATABASE) {
        DATABASE.sync()
            .then(() => console.log('✅ Database synchronized successfully.'))
            .catch((error) => {
                console.error('⚠️ Database sync error (non-fatal):', error.message);
                DatabaseManager.available = false;
            });
    }
} catch (e) {
    console.error('⚠️ Database setup error (non-fatal):', e.message);
    DATABASE = null;
    DatabaseManager.available = false;
}

module.exports = { DATABASE, DatabaseManager };
