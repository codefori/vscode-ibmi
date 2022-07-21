## Quick Start Guide

### Make a connection

1. Press F1
2. Find 'IBM i: New Connection'
3. Enter in your connection details in the window that opens
4. Hit Connect

Tip: next time, try using 'IBM i: Connect to previous'

### Browse/Edit source members

1. Connect to your system.
2. Find the OBJECT BROWSER and click **+ Create new filter**.
3. Complete the new filter dialog, following the descriptive text, ensuring:
   a. That **Object** is the source physical file you want to edit.
   b. That  **Object type filter** is set to *SRCPF.
4. Save settings
5. Click on the filter to expand the members in the source file.
6. Click on a member to open it.

 **Note:** There is no member locking and the extension defaults to not retaining source dates.

### How do I compile my source code?

1. Edit your library list in the 'USER LIBRARY LIST' browser. (Each connection has its own library list.)
2. Open the source you want to compile.
3. Use Ctrl+E or Cmd+E to compile your source.
4. If you have more than one compile option available to you for the type of source, select the appropriate one.
5. If you are using `*EVENTF`, the error listing should automatically load in the PROBLEMS tab.
