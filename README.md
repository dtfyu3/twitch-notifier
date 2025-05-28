# twitch-notifier

Sends logs to google appscript and, if requirements are satisfied, telegram message. AppScript then append logs into the google sheet and provide twitch vod's url to python script which downloads audio from given url and summarize it using gemini. Python script inserts summary into the same sheet.
