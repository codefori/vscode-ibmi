#include <as400_protos.h>
#include <unistd.h>

// gcc cqsh.c -Wl,-blibpath:/QOpenSys/usr/lib -o cqsh

int main(int argc, char **argv)
{
	//re - initialize cached PASE converters
	_SETCCSID(Qp2paseCCSID());

	argv[0] = "/QOpenSys/usr/bin/qsh";

	return execv(argv[0], &argv[0]);
}