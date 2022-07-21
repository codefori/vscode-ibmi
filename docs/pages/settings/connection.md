Multiple connections can be defined and some settings are specific to a connection and can be saved for the connection and later reloaded.

### Current library

The library which will be set as the current library during compilation.

You can change the current library with the 'Change build library' command (F1 -> Change build library).

### Home Directory

Home directory for user. This directory is also the root for the IFS browser.

### Temporary library

Temporary library. Stores temporary objects used by Code for i. Will be created automatically if it does not exist. Cannot be QTEMP.
Default value: ILEDITOR.
Note: If your IBM i runs replication software, there is no need to replicate the temporary library. Your sysadmin may add it to the list of objects to be ignored.

### Temporary IFS directory

Temporary IFS directory. Stores temporary IFS files used by Code for i. Will be created automatically if it does not exist. Must be in root or QOpenSys filesystem.
Default value: /tmp.
Note: If your IBM i runs replication software, there is no need to replicate the temporary directory. Your sysadmin may add it to the list of path to be ignored.
It is safe to have files created by Code for i automatically deleted during maintenance or IPL.

### Source ASP

If source files are located in a specific ASP, specify here.
Otherwise, leave blank.

### Enable source dates

When checked, source dates will be retained.

### Source Dates in Gutter

When checked, source dates will be displayed in the gutter.