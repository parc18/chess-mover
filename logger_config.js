const path = require('path');
const { createLogger, format, transports } = require('winston');

const logger = createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: format.combine(
        format.label({
            label: path.basename(process.mainModule.filename)
        }),
        format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        // Format the metadata object
        format.metadata({
            fillExcept: ['message', 'level', 'timestamp', 'label']
        })
    ),
    transports: [
        new transports.Console({
            format: format.combine(
                format.colorize(),
                format.printf(info => {
                    return `${info.timestamp} [${info.label}] ${info.level}: ${info.message}`;
                })
            )
        }),
        new transports.File({
            filename: 'logs/combined.log',
            format: format.combine(
                // Render in one line in your log file.
                // If you use prettyPrint() here it will be really
                // difficult to exploit your logs files afterwards.
                format.json()
            )
        })
    ],
    exitOnError: false
});

module.exports = logger;