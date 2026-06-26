## Mission  SH - 3.0

- Each agents identity


- About the compaction 
- It have one context window 
- On comapaction everything memory + conversation get replaced with structured summary 
- Then it re-injects specific things from disk 
 - system prompts , global Claude.md , memory.md 
 - Tools skills definations
 - 5 most recectly read files 


- For a projects ( a directory )
- Every session know about it 
- But doesn't know about other sessions 

- Team = Memory.md 
- Player = Sessions 

- For multi agents one will be not enough


# Today Task 
- we have users schema 

-- Directory ( Last 8 char UUID in upper case )
-- A shared file 
- Individual .md files 
- And a Team .md file 

- Memory.md 
- References to this shared files 
- Not the Name the Unique id's ( For claude the id is sesstion ids last 8 char in upper case)

- Channel ( last 8 char UUID in upper case )
- Team.md -> All present memers and the channel descriptions ( file size will be less )
- Conversations.md 

- file name will ne .agent-deck/teams|channels
teams/
- team_<team_name>_<Uiid>/
 - Team.md

- /~.agent-deck/users/
 - user_<name>_<Uiid>.md

channels/
- channel_<channel_name>_<Uiid>/
 - Channel.md
 - Conversations.md 


-- onboadring-agnet
- Create Team -> Onboard members ( agents or people )
- Create Channel -> Add members to that channel -> Team channel or grouup channel 

- To getUUIDLast8DigitInUpperCase() in /Users/amitroy/development/agent-deck/server/utils/index.js -> use this to generate an UUID
- For team and channel you crate the UUID not for the members as they already have the UUID 

- When You creating a team 
- /~.agent-deck/teams/
- team_<team_name>_<Uiid>/
 - Team.md
- /~.agent-deck/users/
 - user_<name>_<Uiid>.md

- For team we have this format if the directory not present you create it 
- Team.md -> In this Briefly write about the team ( why the team and what they do )
- in that file we will have the Team member section 
- about it's role and name id , and referce to that user identity path 

- Now adding or onborading members to the team 
 - First create this file user_<name>_<Uiid>.md in the given path 
 - And add in the file for that with it's id who is he and what it's role and in which chennel he included 
 - Also have Your teams sections where will wirte about the teams where he included 
 - Also have Your Channel sections where will write about the channels where he included
 

 - userId : 
 - teamId : 
 - channelId : 

 ## Members
 --------
- Member Name : **<Name>** · 
- userId : `<member-UUID8>` · 
- About : <description>
- Identity : <role> — `users/user_<name-slug>_<member-UUID8>.md`
---------
- **<Name>** · `<member-UUID8>` · <role> — `users/user_<name-slug>_<member-UUID8>.md`