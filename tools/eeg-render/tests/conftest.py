import os

# The byte-identity and sample-preservation tests pin outputs produced with a
# single BLAS thread (as lab_worker.py renders and run_final_tests.py tests).
# Multithreaded OpenBLAS changes float summation order, so set this before
# numpy is first imported.
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")
