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

Database -> But model cann't read from the data base 
It can Read the messages also 
-> We Have to expose them to in a single place 
-> Best Place is the .md files 
-> Two place one is the DB and other is the .md file 
-> To display in the UI fetch from the Db not from the .md 
-> Channel generic solved 

-> The .md file and the db have to be in Sync 

Also same for the teams :
-> the .md file and the db documents 

Agents.json will become and collections for the agents or users 
